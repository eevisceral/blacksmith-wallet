import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeKeystore, keystoreUnlock } from '../keystore.mjs';
import { callTool } from '../tools.mjs';
import { USER_OP_TOPIC, encodeBalanceOf, parseUserOpEventData } from '../../onchain-ui/kernel.mjs';
import { jrpc } from '../../onchain-ui/dev/seed.mjs';

const FORK = process.env.FORK_RPC;
const ANVIL = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const EOA = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
// The seeded fork 7702-delegates the well-known EOAs; send to a plain address.
const DEST = '0x3333333333333333333333333333333333333333';

test('fork prepare → sign → dry_run submit (skipped without FORK_RPC)', async (t) => {
  if (!FORK) {
    t.skip('set FORK_RPC to run');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'bs-fork-'));
  process.env.BLACKSMITH_HOME = dir;
  process.env.BLACKSMITH_KEYSTORE = join(dir, 'keystore.json');
  const passFile = join(dir, 'passphrase');
  writeFileSync(passFile, 'fork-test\n', { mode: 0o600 });
  process.env.BLACKSMITH_KEYSTORE_PASS_FILE = passFile;
  delete process.env.BLACKSMITH_KEYSTORE_PASS;
  writeKeystore(ANVIL, 'fork-test');
  process.env.BLACKSMITH_POLICY = join(dir, 'policy.json');
  writeFileSync(
    process.env.BLACKSMITH_POLICY,
    JSON.stringify({ max_native_wei: '1000000000000000000', allow_recipients: [DEST], require_dry_run_first: false }),
  );
  keystoreUnlock('fork-test');
  const prep = await callTool('prepare_userop', {
    eoa: EOA,
    chain: 1,
    rpc: FORK,
    to: DEST,
    assets: [{ kind: 'eth', amount: '0.0001' }],
    simulate: false,
  });
  if (/No Kernel|not deployed|Cannot prepare/.test(prep)) {
    t.skip('fork has no Kernel for anvil #0');
    return;
  }
  const userOp = JSON.parse(prep.slice(prep.indexOf('{'), prep.lastIndexOf('}') + 1));
  const signed = await callTool('sign_userop', { chain: 1, rpc: FORK, userOp, signer: 'owner' });
  assert.match(signed, /Signed with owner/i);
  const signedOp = JSON.parse(signed.slice(signed.indexOf('{'), signed.lastIndexOf('}') + 1));
  const dry = await callTool('submit_userop', { chain: 1, rpc: FORK, eoa: EOA, userOp: signedOp });
  assert.match(dry, /Dry-run submit/);
});

test('fork session enable → session-signed USDC send lands (skipped without FORK_RPC)', async (t) => {
  if (!FORK) {
    t.skip('set FORK_RPC to run');
    return;
  }
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const dir = mkdtempSync(join(tmpdir(), 'bs-fork-sess-'));
  process.env.BLACKSMITH_HOME = dir;
  process.env.BLACKSMITH_KEYSTORE = join(dir, 'keystore.json');
  process.env.BLACKSMITH_SESSIONS = join(dir, 'sessions.json');
  process.env.BLACKSMITH_POLICY = join(dir, 'policy.json');
  const passFile = join(dir, 'passphrase');
  writeFileSync(passFile, 'fork-test\n', { mode: 0o600 });
  process.env.BLACKSMITH_KEYSTORE_PASS_FILE = passFile;
  writeKeystore(ANVIL, 'fork-test');
  writeFileSync(
    process.env.BLACKSMITH_POLICY,
    JSON.stringify({
      max_native_wei: '1000000000000000000',
      allow_recipients: [DEST, USDC],
      max_erc20: { [USDC.toLowerCase()]: '100000000' },
      require_dry_run_first: false,
    }),
  );
  keystoreUnlock('fork-test');
  const json = (s, from = 0) => {
    const a = s.indexOf('{', from);
    let d = 0;
    for (let i = a; i < s.length; i++) {
      if (s[i] === '{') d++;
      if (s[i] === '}' && --d === 0) return { op: JSON.parse(s.slice(a, i + 1)), end: i };
    }
    throw new Error('no JSON in ' + s);
  };
  const receipt = async (out) => {
    const tx = /\ntx (0x[0-9a-f]{64})/i.exec(out)[1];
    for (let i = 0; i < 60; i++) {
      const r = await jrpc(FORK, 'eth_getTransactionReceipt', [tx]);
      if (r) return r;
      await new Promise((x) => setTimeout(x, 250));
    }
    throw new Error('no receipt ' + tx);
  };
  const userOpOk = (rec) => {
    const log = rec.logs.find((l) => l.topics[0].toLowerCase() === USER_OP_TOPIC.toLowerCase());
    return parseUserOpEventData(log.data).ok;
  };
  const usdcOf = async (a) => BigInt(await jrpc(FORK, 'eth_call', [{ to: USDC, data: encodeBalanceOf(a) }, 'latest']));

  const created = await callTool('session', { action: 'create', targets: [USDC], selectors: ['0xa9059cbb'] });
  const session = /session key (0x[0-9a-fA-F]{40})/.exec(created)[1];
  const enable = await callTool('session', { action: 'enable', chain: 1, rpc: FORK, eoa: EOA, session });
  let at = 0;
  for (const mode of ['execute', 'executeBatch']) {
    const { op, end } = json(enable, enable.indexOf('\n' + mode + '\n', at));
    at = end;
    const out = await callTool('submit_userop', { userOp: op, chain: 1, rpc: FORK, eoa: EOA, live: true });
    assert.equal((await receipt(out)).status, '0x1');
  }

  const before = await usdcOf(DEST);
  const prep = await callTool('prepare_userop', { eoa: EOA, chain: 1, rpc: FORK, to: DEST, assets: [{ kind: 'token', token: USDC, amount: '1' }] });
  const signed = await callTool('sign_userop', { userOp: json(prep, prep.indexOf('UserOperation v0.6 draft')).op, chain: 1, rpc: FORK, signer: 'session' });
  assert.match(signed, /Signed with session/);
  const out = await callTool('submit_userop', { userOp: json(signed).op, chain: 1, rpc: FORK, eoa: EOA, live: true });
  const rec = await receipt(out);
  assert.equal(userOpOk(rec), true);
  assert.equal((await usdcOf(DEST)) - before, 1000000n);
});
