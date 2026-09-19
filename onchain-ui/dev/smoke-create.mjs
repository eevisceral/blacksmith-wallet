#!/usr/bin/env node
/** Fork: this page’s factory-create a Kernel for Anvil account #1, then send native ETH via handleOps. */
import {
  ACCOUNT_FACTORY,
  ENTRY_POINT,
  EIP1967_IMPL_SLOT,
  KERNEL_IMPL,
  USER_OP_TOPIC,
  encodeExecute,
  encodeFactoryCreate,
  encodeFactoryGetAccount,
  encodeGetNonce,
  encodeGetUserOpHash,
  encodeHandleOps,
  packSudoSignature,
  parseUserOpEventData,
} from '../kernel.mjs';
import { ANVIL_EOA, ensureAccountFactory, jrpc, waitForRpc } from './seed.mjs';

const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const OWNER = process.env.OWNER || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
/** Anvil 0–9 are EIP-7702 delegated on this mainnet fork; native ETH is forwarded. */
const DEST = process.env.DEST || '0x1111111111111111111111111111111111111111';
const DUMMY65 = '0x' + '11'.repeat(65);
const SEND = 10n ** 16n; // 0.01 ETH
const FUND = 2n * 10n ** 18n;

function codeOn(hex) {
  return !!(hex && hex !== '0x' && hex !== '0x0');
}

function word(h) {
  return BigInt(h && h !== '0x' ? h : '0x0');
}

async function waitReceipt(hash) {
  for (let i = 0; i < 40; i++) {
    const r = await jrpc(RPC, 'eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise((x) => setTimeout(x, 250));
  }
  throw new Error('no receipt ' + hash);
}

async function main() {
  await waitForRpc(RPC);
  if (OWNER.toLowerCase() === ANVIL_EOA.toLowerCase()) throw new Error('OWNER must not be the seeded EOA');
  await ensureAccountFactory(RPC);
  const raw = await jrpc(RPC, 'eth_call', [{ to: ACCOUNT_FACTORY, data: encodeFactoryGetAccount(OWNER) }, 'latest']);
  const aa = '0x' + String(raw).slice(-40);
  let code = await jrpc(RPC, 'eth_getCode', [aa, 'latest']);
  let txHash = '';
  if (!codeOn(code)) {
    txHash = await jrpc(RPC, 'eth_sendTransaction', [
      { from: OWNER, to: ACCOUNT_FACTORY, data: encodeFactoryCreate(OWNER), value: '0x0' },
    ]);
    const rec = await waitReceipt(txHash);
    if (BigInt(rec.status) === 0n) throw new Error('createAccount reverted ' + txHash);
    code = await jrpc(RPC, 'eth_getCode', [aa, 'latest']);
  }
  if (!codeOn(code)) throw new Error('Kernel still empty at ' + aa);
  const impl = '0x' + String(await jrpc(RPC, 'eth_getStorageAt', [aa, EIP1967_IMPL_SLOT, 'latest'])).slice(-40);
  if (impl.toLowerCase() !== KERNEL_IMPL.toLowerCase()) throw new Error('unexpected impl ' + impl);

  await jrpc(RPC, 'anvil_setBalance', [aa, '0x' + FUND.toString(16)]);
  const before = word(await jrpc(RPC, 'eth_getBalance', [DEST, 'latest']));
  const nonce = word(await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetNonce(aa) }, 'latest']));
  const block = await jrpc(RPC, 'eth_getBlockByNumber', ['latest', false]);
  const base = word(block.baseFeePerGas || '0x0');
  const maxPriorityFeePerGas = 10n ** 9n;
  const maxFeePerGas = base * 2n + maxPriorityFeePerGas;
  const dummy = packSudoSignature(DUMMY65);
  const op = {
    sender: aa,
    nonce,
    initCode: '0x',
    callData: encodeExecute(DEST, SEND, '0x'),
    callGasLimit: 280000n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterAndData: '0x',
    signature: dummy,
  };
  const uoh = '0x' + (await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetUserOpHash(op) }, 'latest'])).slice(-64);
  const sig = await jrpc(RPC, 'personal_sign', [uoh, OWNER]);
  op.signature = packSudoSignature(sig);
  const sendHash = await jrpc(RPC, 'eth_sendTransaction', [
    { from: OWNER, to: ENTRY_POINT, data: encodeHandleOps(op, OWNER), value: '0x0' },
  ]);
  const sendRec = await waitReceipt(sendHash);
  if (BigInt(sendRec.status) === 0n) throw new Error('handleOps reverted ' + sendHash);
  const uolog = (sendRec.logs || []).find((l) => String(l.topics?.[0]).toLowerCase() === USER_OP_TOPIC.toLowerCase());
  if (!uolog || parseUserOpEventData(uolog.data)?.ok !== true) throw new Error('UserOp failed ' + sendHash);
  const destCode = await jrpc(RPC, 'eth_getCode', [DEST, 'latest']);
  if (destCode && destCode !== '0x' && destCode !== '0x0') throw new Error('DEST has code; pick an empty EOA');
  const after = word(await jrpc(RPC, 'eth_getBalance', [DEST, 'latest']));
  if (after - before !== SEND) throw new Error(`ETH not received: before ${before} after ${after} want +${SEND}`);
  console.log('ok', txHash || 'already', aa, 'sent', sendHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
