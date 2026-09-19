/**
 * Optional fork: prepare → sign (anvil #0) → dry_run submit.
 *   FORK_RPC=http://127.0.0.1:8545 node --test mcp/test/fork-sign.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeKeystore, keystoreUnlock } from '../keystore.mjs';
import { callTool } from '../tools.mjs';

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
  process.env.BLACKSMITH_KEYSTORE_PASS = 'fork-test';
  writeKeystore(ANVIL, 'fork-test');
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
