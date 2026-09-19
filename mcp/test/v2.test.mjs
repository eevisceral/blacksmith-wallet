import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
  assert.ok(plug.toLowerCase().includes(SESSION_KEY_VALIDATOR.slice(2).toLowerCase()));
  assert.ok(plug.toLowerCase().includes(ANVIL_ADDR.slice(2)));
  const en = packEnableSignature({
    enableData: encodeSessionEnableData({ sessionKey: ANVIL_ADDR, nonce: 1n }),
    enableSig: dummy,
    validatorSig: dummy,
  });
  assert.equal(en.slice(0, 10), '0x00000002');
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
  void dir;
});

test('session permission checks (MCP-side)', () => {
  const sess = { unrestricted: false, targets: [USDC], selectors: ['a9059cbb'], valueLimit: '0', validUntil: 0xfffffffffffe };
  const tok = encodeExecute(USDC, 0n, '0xa9059cbb' + DEST.slice(2).padStart(64, '0') + '1'.padStart(64, '0'));
  assert.equal(sessionCovers({ callData: tok }, sess), '');
  assert.match(sessionCovers({ callData: encodeExecute(DEST, 1n, '0x') }, sess), /target/);
  assert.equal(sessionCovers({ callData: encodeExecute(DEST, 1n, '0x') }, { unrestricted: true }), '');
});

test('keystore unlock TTL + session create without leaking keys', async () => {
  home();
  writeKeystore(ANVIL, process.env.BLACKSMITH_KEYSTORE_PASS);
  const text = await callTool('keystore', { action: 'unlock' });
  assert.match(text, /Unlocked owner/i);
  assert.doesNotMatch(text, /ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80/i);
  assert.equal(unlockedOwner().address, ANVIL_ADDR);
  const created = await callTool('session', { action: 'create' });
  assert.match(created, /Created session key 0x/i);
  assert.doesNotMatch(created, /private key 0x/i);
  const st = await callTool('session', { action: 'status' });
  assert.match(st, /1 stored/);
  sessionUnlock();
  assert.ok(unlockedSession().address);
  await callTool('keystore', { action: 'lock' });
  assert.equal(unlockedOwner(), null);
  keystoreLock();
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
