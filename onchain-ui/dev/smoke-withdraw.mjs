#!/usr/bin/env node
/** Fork dust withdraw: USDC via Kernel execute + EntryPoint.handleOps. */
import {
  ENTRY_POINT,
  KERNEL_FACTORY,
  encodeBalanceOf,
  encodeExecute,
  encodeGetAccountAddress,
  encodeGetNonce,
  encodeGetUserOpHash,
  encodeHandleOps,
  encodeTransfer,
  packSudoSignature,
} from '../kernel.mjs';
import { ANVIL_EOA, USDC, jrpc, waitForRpc } from './seed.mjs';

const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const DEST = process.env.DEST || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const DUMMY65 = '0x' + '11'.repeat(65);

function word(h) {
  return BigInt(h && h !== '0x' ? h : '0x0');
}

async function main() {
  await waitForRpc(RPC);
  const raw = await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(ANVIL_EOA) }, 'latest']);
  const AA = process.env.AA || '0x' + String(raw).slice(-40);
  const before = word(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(DEST) }, 'latest']));
  const kernelUsdc = word(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(AA) }, 'latest']));
  if (kernelUsdc === 0n) throw new Error('kernel has no USDC');

  const amount = kernelUsdc < 10n ** 6n ? kernelUsdc : 10n ** 6n; // 1 USDC dust
  const nonce = word(await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetNonce(AA) }, 'latest']));
  const block = await jrpc(RPC, 'eth_getBlockByNumber', ['latest', false]);
  const base = word(block.baseFeePerGas || '0x0');
  const maxPriorityFeePerGas = 10n ** 9n;
  const maxFeePerGas = base * 2n + maxPriorityFeePerGas;
  const dummy = packSudoSignature(DUMMY65);
  const op = {
    sender: AA,
    nonce,
    initCode: '0x',
    callData: encodeExecute(USDC, 0n, encodeTransfer(DEST, amount)),
    callGasLimit: 280000n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterAndData: '0x',
    signature: dummy,
  };
  const hash = '0x' + (await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetUserOpHash(op) }, 'latest'])).slice(-64);
  const sig = await jrpc(RPC, 'personal_sign', [hash, ANVIL_EOA]);
  op.signature = packSudoSignature(sig);
  const data = encodeHandleOps(op, ANVIL_EOA);
  const txHash = await jrpc(RPC, 'eth_sendTransaction', [
    { from: ANVIL_EOA, to: ENTRY_POINT, data, value: '0x0' },
  ]);
  let rec;
  for (let i = 0; i < 40; i++) {
    rec = await jrpc(RPC, 'eth_getTransactionReceipt', [txHash]);
    if (rec) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!rec || BigInt(rec.status) === 0n) throw new Error('handleOps reverted ' + txHash);
  const after = word(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(DEST) }, 'latest']));
  if (after - before !== amount) throw new Error(`USDC not received: before ${before} after ${after} want +${amount}`);
  console.log('ok', txHash, 'dust', amount.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
