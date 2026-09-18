import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_POINT,
  KERNEL_IMPL,
  encodeExecute,
  encodeExecuteBatch,
  encodeTransfer,
  encodeWithdrawTo,
  nativeOutValue,
  epOutValue,
  requiredPrefund,
} from '../../onchain-ui/kernel.mjs';
import { TOOLS, callTool, normChain, normAssets, planCalls, decodeCallData, normOp, WALLET_URL } from '../tools.mjs';

const DEST = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const AA = '0x2222222222222222222222222222222222222222';

test('exactly the 7 locked tools, in order', () => {
  assert.deepEqual(
    TOOLS.map((t) => t.name),
    ['resolve_account', 'get_balances', 'list_tokens', 'get_activity', 'prepare_send', 'explain_userop', 'wallet_url'],
  );
  for (const t of TOOLS) {
    assert.ok(t.description && t.inputSchema, t.name);
  }
});

test('normChain', () => {
  for (const v of [1, '1', 'ethereum', 'eth', 'mainnet', 'Ethereum']) assert.equal(normChain(v), 1);
  for (const v of [8453, '8453', 'base', 'BASE']) assert.equal(normChain(v), 8453);
  assert.throws(() => normChain('solana'), /1 \(Ethereum\) or 8453/);
  assert.throws(() => normChain(undefined), /chain/);
});

test('normAssets kinds, synonyms, validation', () => {
  assert.deepEqual(normAssets([{ kind: 'native', amount: '1' }]), [{ kind: 'eth', amount: '1' }]);
  assert.deepEqual(normAssets([{ kind: 'erc20', token: USDC, amount: 'max' }]), [
    { kind: 'token', amount: 'max', token: USDC },
  ]);
  assert.equal(normAssets([{ kind: 'ep', amount: '0.1' }])[0].kind, 'deposit');
  assert.throws(() => normAssets([]), /at least one/);
  assert.throws(() => normAssets([{ kind: 'nft', amount: '1' }]), /eth, token, or deposit/);
  assert.throws(() => normAssets([{ kind: 'eth' }]), /amount is required/);
  assert.throws(() => normAssets([{ kind: 'token', amount: '1' }]), /token address/);
});

test('planCalls caps and calls', () => {
  const prefund = requiredPrefund(280000n, 300000n, 80000n, 3n * 10n ** 9n);
  const eth = 2n * 10n ** 18n;
  const dep = 5n * 10n ** 16n;
  const tokens = new Map([[USDC.toLowerCase(), { bal: 5000000n, decimals: 6, symbol: 'USDC' }]]);

  const maxEth = planCalls([{ kind: 'eth', amount: 'max' }], { to: DEST, eth, dep, prefund, tokens });
  const cap = nativeOutValue(eth, prefund);
  assert.equal(maxEth.calls[0].to, DEST);
  assert.equal(maxEth.calls[0].value, cap);
  assert.equal(maxEth.calls[0].data, '0x');
  assert.ok(cap > 0n && cap < eth - prefund);

  const over = planCalls([{ kind: 'eth', amount: '3' }], { to: DEST, eth, dep, prefund, tokens });
  assert.match(over.err, /spendable max/);

  const broke = planCalls([{ kind: 'eth', amount: 'max' }], { to: DEST, eth: prefund, dep, prefund, tokens });
  assert.match(broke.err, /nothing spendable/);

  const tok = planCalls([{ kind: 'token', token: USDC, amount: 'max' }], { to: DEST, eth, dep, prefund, tokens });
  assert.equal(tok.calls[0].to, USDC);
  assert.equal(tok.calls[0].data, encodeTransfer(DEST, 5000000n));

  const tokOver = planCalls([{ kind: 'token', token: USDC, amount: '6' }], { to: DEST, eth, dep, prefund, tokens });
  assert.match(tokOver.err, /more than the account holds/);

  const ep = planCalls([{ kind: 'deposit', amount: 'max' }], { to: DEST, eth, dep, prefund, tokens });
  assert.equal(ep.calls[0].to, ENTRY_POINT);
  assert.equal(ep.calls[0].data, encodeWithdrawTo(DEST, epOutValue(dep, prefund)));

  const batch = planCalls(
    [
      { kind: 'eth', amount: '0.1' },
      { kind: 'token', token: USDC, amount: '1.5' },
    ],
    { to: DEST, eth, dep, prefund, tokens },
  );
  assert.equal(batch.calls.length, 2);
  assert.equal(batch.ethOut, 10n ** 17n);
  assert.equal(batch.epOut, 0n);
});

test('decodeCallData round-trips the kernel encoders', () => {
  const one = decodeCallData(encodeExecute(DEST, 10n ** 18n, '0x'));
  assert.equal(one.kind, 'execute');
  assert.equal(one.operation, 0);
  assert.equal(one.calls[0].to, DEST.toLowerCase());
  assert.equal(one.calls[0].value, 10n ** 18n);
  assert.equal(one.calls[0].data, '0x');

  const batch = decodeCallData(
    encodeExecuteBatch([
      { to: DEST, value: 1n, data: '0x' },
      { to: USDC, value: 0n, data: encodeTransfer(DEST, 5n) },
      { to: ENTRY_POINT, value: 0n, data: encodeWithdrawTo(DEST, 7n) },
    ]),
  );
  assert.equal(batch.kind, 'executeBatch');
  assert.equal(batch.calls.length, 3);
  assert.equal(batch.calls[1].to, USDC.toLowerCase());
  assert.equal(batch.calls[1].data, encodeTransfer(DEST, 5n));
  assert.equal(batch.calls[2].data, encodeWithdrawTo(DEST, 7n));

  assert.equal(decodeCallData('0xdeadbeef').kind, 'other');
  assert.throws(() => decodeCallData('0x51945447' + '00'.repeat(32)), /truncated/);
  assert.throws(() => decodeCallData('xyz'), /0x-hex/);
});

test('normOp takes objects and JSON, hex or decimal fields', () => {
  const base = {
    sender: AA,
    nonce: '0x5',
    initCode: '0x',
    callData: encodeExecute(DEST, 1n, '0x'),
    callGasLimit: '280000',
    verificationGasLimit: 300000,
    preVerificationGas: '0x13880',
    maxFeePerGas: '0xb2d05e00',
    maxPriorityFeePerGas: '0x3b9aca00',
    paymasterAndData: '0x',
    signature: '0x',
  };
  const op = normOp(JSON.stringify(base));
  assert.equal(op.nonce, 5n);
  assert.equal(op.callGasLimit, 280000n);
  assert.equal(op.preVerificationGas, 80000n);
  assert.equal(op.maxFeePerGas, 3n * 10n ** 9n);
  assert.throws(() => normOp('not json'), /JSON/);
  assert.throws(() => normOp({ ...base, sender: '0x123' }), /sender/);
});

test('explain_userop decodes a draft offline', async () => {
  const callData = encodeExecuteBatch([
    { to: DEST, value: 10n ** 17n, data: '0x' },
    { to: USDC, value: 0n, data: encodeTransfer(DEST, 1500000n) },
  ]);
  const text = await callTool('explain_userop', {
    userOp: {
      sender: AA,
      nonce: 5,
      initCode: '0x',
      callData,
      callGasLimit: 360000,
      verificationGasLimit: 300000,
      preVerificationGas: 80000,
      maxFeePerGas: 3000000000,
      maxPriorityFeePerGas: 1000000000,
      paymasterAndData: '0x',
      signature: '0x00000000' + '00'.repeat(65),
    },
  });
  assert.match(text, /sender 0x2222222222222222222222222222222222222222 · nonce 5/);
  assert.match(text, /initCode empty · paymasterAndData empty/);
  assert.match(text, /prefund 2220000000000000 wei/); // (360000+300000+80000) × 3 gwei
  assert.match(text, /ECDSA sudo/);
  assert.match(text, /executeBatch, 2 calls/);
  assert.match(text, /0\.1 ETH → 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 \(native ETH\)/);
  assert.match(text, /ERC-20 transfer 1500000 base units → 0xd8da6bf26964af9d7eed9e03e53415d37aa96045/);
  assert.match(text, /AA21/);
  assert.match(text, /AA23 — validation reverted; not a signature miss/);
  assert.match(text, /AA24 — signature error/);
});

test('explain_userop reads bare callData and flags foreign selectors', async () => {
  const text = await callTool('explain_userop', { callData: encodeExecute(DEST, 1n, '0x') });
  assert.match(text, /Kernel execute, 1 call/);
  const raw = await callTool('explain_userop', { callData: encodeTransfer(DEST, 5n) });
  assert.match(raw, /raw transfer, not wrapped in Kernel execute/);
  const other = await callTool('explain_userop', { callData: '0xdeadbeef' + '00'.repeat(32) });
  assert.match(other, /not Kernel execute/);
  await assert.rejects(() => callTool('explain_userop', {}), /userOp.*or callData/);
});

test('explain_userop warns on non-sudo signature mode and set initCode', async () => {
  const text = await callTool('explain_userop', {
    userOp: {
      sender: AA,
      nonce: 0,
      initCode: '0x1234',
      callData: encodeExecute(DEST, 1n, '0x'),
      callGasLimit: 1,
      verificationGasLimit: 1,
      preVerificationGas: 1,
      maxFeePerGas: 1,
      maxPriorityFeePerGas: 1,
      paymasterAndData: '0x',
      signature: '0x00000001' + '00'.repeat(65),
    },
  });
  assert.match(text, /initCode SET — this wallet sends empty initCode/);
  assert.match(text, /mode 0x00000001 — not the ECDSA sudo mode/);
});

test('wallet_url points at the hosted wallet and local freeze', async () => {
  const text = await callTool('wallet_url', {});
  assert.match(text, new RegExp(WALLET_URL.replace(/[/.]/g, '\\$&')));
  assert.match(text, /dist[\\/]index\.html/);
  assert.match(text, /never signs and never broadcasts/);
});

test('kernel impl constant still matches the wallet encoding source', () => {
  assert.equal(KERNEL_IMPL, '0xd3082872F8B06073A021b4602e022d5A070d7cfC');
});
