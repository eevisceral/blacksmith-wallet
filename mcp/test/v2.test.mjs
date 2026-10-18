import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  packSudoSignature,
  packSessionPluginSignature,
  packEnableSignature,
  encodeSessionEnableData,
  SESSION_KEY_VALIDATOR,
  encodeExecute,
} from '../../onchain-ui/kernel.mjs';
import {
  keccak256,
  privateToAddress,
  personalSign,
  personalSignHash,
  recoverAddress,
  encryptKeystore,
  decryptKeystore,
} from '../eth-crypto.mjs';
import { policyCheck, sessionCovers, markDryRun, sawDryRun, loadPolicy } from '../policy.mjs';
import { emptyOpFields, liveSubmitGuards } from '../aa-sign.mjs';
import { encodeBatchProof, permissionLeaf } from '../session-merkle.mjs';
import { writeKeystore, keystoreUnlock, keystoreLock, unlockedOwner } from '../keystore.mjs';
import { sessionCreate, sessionUnlock, unlockedSession, sessionRevokeLocal } from '../session.mjs';
import { TOOLS, callTool, normOp } from '../tools.mjs';

const ANVIL = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ANVIL_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const DEST = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const AA = '0x2222222222222222222222222222222222222222';

function home() {
  const dir = mkdtempSync(join(tmpdir(), 'bs-mcp-'));
  process.env.BLACKSMITH_HOME = dir;
  process.env.BLACKSMITH_KEYSTORE = join(dir, 'keystore.json');
  process.env.BLACKSMITH_SESSIONS = join(dir, 'sessions.json');
  process.env.BLACKSMITH_POLICY = join(dir, 'policy.json');
  process.env.BLACKSMITH_KEYSTORE_PASS = 'test-pass-not-for-prod';
  return dir;
}

test('tool list is the original seven plus keystore session sign_userop submit_userop (11)', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), [
    'resolve_account',
    'get_balances',
    'list_tokens',
    'get_activity',
    'prepare_userop',
    'explain_userop',
    'wallet_url',
    'keystore',
    'session',
    'sign_userop',
    'submit_userop',
  ]);
});

test('keccak and secp256k1: anvil #0 address and recover', () => {
  assert.equal(privateToAddress(ANVIL), ANVIL_ADDR);
  const h = keccak256(Buffer.from('blacksmith'));
  const sig = personalSign(ANVIL, h);
  assert.equal(sig.length, 132);
  assert.equal(recoverAddress(personalSignHash(h), sig), ANVIL_ADDR);
});

test('keystore v3 round-trip never exposes the key in JSON address-only', () => {
  const ks = encryptKeystore(ANVIL, 'pw', ANVIL_ADDR);
  assert.equal(ks.address, ANVIL_ADDR.slice(2));
  assert.equal(decryptKeystore(ks, 'pw').toLowerCase(), ANVIL);
  assert.throws(() => decryptKeystore(ks, 'nope'), /passphrase/);
});

test('pack sudo / session plugin / enable signatures', () => {
  const dummy = '0x' + '11'.repeat(65);
  assert.equal(packSudoSignature(dummy).slice(0, 10), '0x00000000');
  const plug = packSessionPluginSignature(ANVIL_ADDR, dummy);
  assert.equal(plug.slice(0, 10), '0x00000001');
  assert.equal(plug.slice(10, 50).toLowerCase(), ANVIL_ADDR.slice(2).toLowerCase());
  assert.equal(plug.toLowerCase().includes(SESSION_KEY_VALIDATOR.slice(2).toLowerCase()), false);
  assert.equal(plug.length, 2 + 8 + 40 + 130);
  assert.equal(
    permissionLeaf({ index: 0, target: '0x1111111111111111111111111111111111111111', sig: '0xa9059cbb', valueLimit: 1000n }),
    '0xd4254abddf801fed6a9eafe0ed21295eea9cb69a686bb4a4976f6f22f15bdd61',
  );
  const batch = encodeBatchProof(
    [
      { index: 0, target: '0x1111111111111111111111111111111111111111', sig: '0xa9059cbb', valueLimit: 1000n },
      { index: 1, target: '0x1111111111111111111111111111111111111111', sig: '0x095ea7b3', valueLimit: 1000n },
    ],
    [['0x' + 'abc'.padStart(64, '0')], ['0x' + 'def'.padStart(64, '0')]],
  );
  const raw = keccak256(Buffer.from(batch.slice(2), 'hex'));
  const got = Buffer.isBuffer(raw) ? '0x' + raw.toString('hex') : String(raw);
  assert.equal(got, '0x0c912ba9af8b4e5c1ec1b0d815bcdb5fc8722ccee9c069ace957e1e540783574');
  const en = packEnableSignature({
    enableData: encodeSessionEnableData({ sessionKey: ANVIL_ADDR, nonce: 1n }),
    enableSig: dummy,
    validatorSig: dummy,
  });
  assert.equal(en.slice(0, 10), '0x00000002');
});

test('live submit refuses public RPC, wrong chain, and initCode', () => {
  assert.equal(
    liveSubmitGuards({ exclusiveRpc: true, chain: 1, rpcChainId: 1, initCode: '0x', paymasterAndData: '0x' }),
    '',
  );
  assert.match(
    liveSubmitGuards({ exclusiveRpc: false, chain: 1, rpcChainId: 1, initCode: '0x', paymasterAndData: '0x' }),
    /exclusive RPC/,
  );
  assert.match(
    liveSubmitGuards({ exclusiveRpc: true, chain: 1, rpcChainId: 8453, initCode: '0x', paymasterAndData: '0x' }),
    /does not match/,
  );
  assert.match(
    liveSubmitGuards({ exclusiveRpc: true, chain: 31337, rpcChainId: 31337, initCode: '0x', paymasterAndData: '0x' }),
    /Ethereum \(1\) or Base/,
  );
  assert.match(emptyOpFields({ initCode: '0x00ab', paymasterAndData: '0x' }), /initCode/);
  assert.match(emptyOpFields({ initCode: '0x', paymasterAndData: '0x1234' }), /paymasterAndData/);
});

test('policy gates native, recipients, dry-run flag', () => {
  const dir = home();
  writeFileSync(
    process.env.BLACKSMITH_POLICY,
    JSON.stringify({
      max_native_wei: '1000',
      allow_recipients: [DEST],
      require_dry_run_first: true,
    }),
  );
  const op = {
    callData: encodeExecute(DEST, 2000n, '0x'),
    sender: AA,
    nonce: 0n,
  };
  const pol = loadPolicy();
  assert.match(policyCheck(op, pol), /max_native_wei/);
  const okOp = { callData: encodeExecute(DEST, 1n, '0x') };
  assert.equal(policyCheck(okOp, pol), '');
  const bad = { callData: encodeExecute(USDC, 1n, '0x') };
  assert.match(policyCheck(bad, pol), /allowlist/);
  assert.equal(sawDryRun('0xabc'), false);
  markDryRun('0xAbC');
  assert.equal(sawDryRun('0xabc'), true);
  const disk = JSON.parse(readFileSync(join(dir, 'dry-runs.json'), 'utf8'));
  assert.ok(disk['0xabc']);
});

test('session permission checks (MCP-side)', () => {
  const sess = { unrestricted: false, targets: [USDC], selectors: ['a9059cbb'], valueLimit: '0', validUntil: 0xfffffffffffe };
  const tok = encodeExecute(USDC, 0n, '0xa9059cbb' + DEST.slice(2).padStart(64, '0') + '1'.padStart(64, '0'));
  assert.equal(sessionCovers({ callData: tok }, sess), '');
  assert.match(sessionCovers({ callData: encodeExecute(DEST, 1n, '0x') }, sess), /target/);
  assert.equal(sessionCovers({ callData: encodeExecute(DEST, 1n, '0x') }, { unrestricted: true }), '');
  const delegate = '0xb68df16d' + '0'.repeat(56);
  const pol = {
    missing: false,
    allow_recipients: [DEST.toLowerCase()],
    max_native_wei: 10n ** 18n,
    max_erc20: {},
  };
  assert.match(policyCheck({ callData: delegate }, pol), /execute or executeBatch/);
  const op1 = encodeExecute(DEST, 0n, '0x').replace(/(0x[0-9a-f]{8}(?:[0-9a-f]{64}){3})[0-9a-f]{64}/i, '$1' + '0'.repeat(63) + '1');
  assert.match(policyCheck({ callData: op1 }, pol), /operation must be 0/);
  assert.match(sessionCovers({ callData: op1 }, { unrestricted: true }), /operation must be 0/);
  assert.match(policyCheck({ callData: encodeExecute(DEST, 1n, '0x') }, { ...pol, missing: true }), /no policy.json/);
});

test('keystore unlock TTL + session create without leaking keys', async () => {
  home();
  writeKeystore(ANVIL, process.env.BLACKSMITH_KEYSTORE_PASS);
  const text = await callTool('keystore', { action: 'unlock' });
  assert.match(text, /Unlocked owner/i);
  assert.doesNotMatch(text, /ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80/i);
  assert.equal(unlockedOwner().address, ANVIL_ADDR);
  const created = await callTool('session', { action: 'create', unrestricted: true });
  assert.match(created, /Created session key 0x/i);
  assert.doesNotMatch(created, /private key 0x/i);
  const st = await callTool('session', { action: 'status' });
  assert.match(st, /1 stored/);
  sessionUnlock();
  assert.ok(unlockedSession().address);
  await callTool('keystore', { action: 'lock' });
  assert.equal(unlockedOwner(), null);
  assert.equal(unlockedSession(), null);
  keystoreLock();
});

test('session create without targets or unrestricted is refused', async () => {
  home();
  writeKeystore(ANVIL, process.env.BLACKSMITH_KEYSTORE_PASS);
  keystoreUnlock(process.env.BLACKSMITH_KEYSTORE_PASS);
  await assert.rejects(() => callTool('session', { action: 'create' }), /unrestricted: true/);
});

test('keystore rejects passphrase tool args', async () => {
  await assert.rejects(() => callTool('keystore', { action: 'unlock', passphrase: 'x' }), /Do not pass secrets/);
});

test('explain_userop names session plugin mode', async () => {
  const text = await callTool('explain_userop', {
    userOp: {
      sender: AA,
      nonce: 0,
      initCode: '0x',
      callData: encodeExecute(DEST, 1n, '0x'),
      callGasLimit: 1,
      verificationGasLimit: 1,
      preVerificationGas: 1,
      maxFeePerGas: 1,
      maxPriorityFeePerGas: 1,
      paymasterAndData: '0x',
      signature: packSessionPluginSignature(ANVIL_ADDR, '0x' + '11'.repeat(65)),
    },
  });
  assert.match(text, /plugin \(session-key validator\)/);
});

test('normOp still accepts signed ops', () => {
  const op = normOp({
    sender: AA,
    nonce: 1,
    initCode: '0x',
    callData: encodeExecute(DEST, 1n, '0x'),
    callGasLimit: 1,
    verificationGasLimit: 1,
    preVerificationGas: 1,
    maxFeePerGas: 1,
    maxPriorityFeePerGas: 1,
    paymasterAndData: '0x',
    signature: packSudoSignature('0x' + '22'.repeat(65)),
  });
  assert.equal(op.signature.length, 2 + 8 + 130);
});

void sessionRevokeLocal;
void sessionCreate;
void keystoreUnlock;
