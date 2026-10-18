#!/usr/bin/env node
/** Fork: executeBatch, prepaid-gas withdraw, 0-decimal transfer, Received, Activity logs. */
import {
  ENTRY_POINT,
  KERNEL_FACTORY,
  USER_OP_TOPIC,
  WITHDRAWN_TOPIC,
  RECEIVED_TOPIC,
  TRANSFER_TOPIC,
  encodeBalanceOf,
  encodeExecute,
  encodeExecuteBatch,
  encodeGetAccountAddress,
  encodeGetNonce,
  encodeGetUserOpHash,
  encodeHandleOps,
  encodeTransfer,
  encodeWithdrawTo,
  packSudoSignature,
  parseUserOpEventData,
  parseWithdrawnData,
  parseReceivedData,
  nativeOutValue,
  requiredPrefund,
} from '../kernel.mjs';
import { setRpcUrl, scanAccountLogs } from '../rpc.mjs';
import { ANVIL_EOA, USDC, jrpc, waitForRpc, forkMinedFromBlock } from './seed.mjs';

const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const ETH_DEST = '0x1111111111111111111111111111111111111111';
const USDC_DEST = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const EP_DEST = '0x2222222222222222222222222222222222222222';
const DUMMY65 = '0x' + '11'.repeat(65);
const ETH_SEND = 10n ** 15n; // 0.001
const USDC_SEND = 10n ** 6n;
const EP_SEND = 10n ** 15n;
const TOY_SEND = 1n;

function fail(reason) {
  console.error('FAIL', reason);
  process.exit(1);
}

function word(h) {
  return BigInt(h && h !== '0x' ? h : '0x0');
}

function topic0(l) {
  return String(l.topics?.[0] || '').toLowerCase();
}

async function waitReceipt(hash) {
  for (let i = 0; i < 40; i++) {
    const r = await jrpc(RPC, 'eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise((x) => setTimeout(x, 250));
  }
  fail('no receipt ' + hash);
}

async function sendOp(aa, owner, callData, nCalls) {
  const nonce = word(await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetNonce(aa) }, 'latest']));
  const block = await jrpc(RPC, 'eth_getBlockByNumber', ['latest', false]);
  const base = word(block.baseFeePerGas || '0x0');
  const maxPriorityFeePerGas = 10n ** 9n;
  const maxFeePerGas = base * 2n + maxPriorityFeePerGas;
  const n = BigInt(nCalls < 1 ? 1 : nCalls);
  const op = {
    sender: aa,
    nonce,
    initCode: '0x',
    callData,
    callGasLimit: 200000n + 80000n * n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterAndData: '0x',
    signature: packSudoSignature(DUMMY65),
  };
  const uoh = '0x' + (await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetUserOpHash(op) }, 'latest'])).slice(-64);
  op.signature = packSudoSignature(await jrpc(RPC, 'personal_sign', [uoh, owner]));
  const txHash = await jrpc(RPC, 'eth_sendTransaction', [
    { from: owner, to: ENTRY_POINT, data: encodeHandleOps(op, owner), value: '0x0' },
  ]);
  const rec = await waitReceipt(txHash);
  if (BigInt(rec.status) === 0n) fail('handleOps reverted ' + txHash);
  const uolog = (rec.logs || []).find((l) => topic0(l) === USER_OP_TOPIC.toLowerCase());
  const parsed = uolog && parseUserOpEventData(uolog.data);
  if (!parsed || parsed.ok !== true) fail('UserOp failed ' + txHash);
  return { rec, txHash, parsed, op };
}

async function toy0(aa) {
  try {
    const page = await fetch('http://127.0.0.1:8765/', { signal: AbortSignal.timeout(2000) }).then((r) => r.text());
    const m = page.match(/window\.__V1_FORK__=(\{.*?\});/);
    const tokens = m ? JSON.parse(m[1]).tokens || [] : [];
    for (const t of tokens) {
      const dec = Number(BigInt(await jrpc(RPC, 'eth_call', [{ to: t, data: '0x313ce567' }, 'latest'])));
      if (dec !== 0) continue;
      const bal = word(await jrpc(RPC, 'eth_call', [{ to: t, data: encodeBalanceOf(aa) }, 'latest']));
      if (bal > 0n) return t;
    }
  } catch {
    /* playground optional */
  }
  fail('no 0-decimal toy with balance; start node onchain-ui/dev/run.mjs');
}

async function main() {
  await waitForRpc(RPC);
  setRpcUrl(RPC);
  const raw = await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(ANVIL_EOA) }, 'latest']);
  const aa = '0x' + String(raw).slice(-40);
  const code = await jrpc(RPC, 'eth_getCode', [aa, 'latest']);
  if (!code || code === '0x') fail('seeded Kernel missing');

  const kernelEth = word(await jrpc(RPC, 'eth_getBalance', [aa, 'latest']));
  const prefund = requiredPrefund(280000n, 300000n, 80000n, 3n * 10n ** 9n);
  if (nativeOutValue(kernelEth, prefund) === 0n) fail('Kernel ETH too low for native out');
  if (nativeOutValue(kernelEth, prefund) + prefund >= kernelEth) fail('nativeOutValue must leave a buffer');

  const toy = await toy0(aa);
  const ethBefore = word(await jrpc(RPC, 'eth_getBalance', [ETH_DEST, 'latest']));
  const usdcBefore = word(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(USDC_DEST) }, 'latest']));
  const toyBefore = word(await jrpc(RPC, 'eth_call', [{ to: toy, data: encodeBalanceOf(USDC_DEST) }, 'latest']));
  const epBefore = word(await jrpc(RPC, 'eth_getBalance', [EP_DEST, 'latest']));
  const depBefore = word(await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeBalanceOf(aa) }, 'latest']));
  if (depBefore <= EP_SEND + prefund) fail('EntryPoint deposit too low for withdraw');

  const batch = await sendOp(
    aa,
    ANVIL_EOA,
    encodeExecuteBatch([
      { to: ETH_DEST, value: ETH_SEND, data: '0x' },
      { to: USDC, value: 0n, data: encodeTransfer(USDC_DEST, USDC_SEND) },
      { to: toy, value: 0n, data: encodeTransfer(USDC_DEST, TOY_SEND) },
    ]),
    3
  );
  const ethAfter = word(await jrpc(RPC, 'eth_getBalance', [ETH_DEST, 'latest']));
  const usdcAfter = word(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(USDC_DEST) }, 'latest']));
  const toyAfter = word(await jrpc(RPC, 'eth_call', [{ to: toy, data: encodeBalanceOf(USDC_DEST) }, 'latest']));
  if (ethAfter - ethBefore !== ETH_SEND) fail('batch ETH not received');
  if (usdcAfter - usdcBefore !== USDC_SEND) fail('batch USDC not received');
  if (toyAfter - toyBefore !== TOY_SEND) fail('0-decimal toy not received');

  const ep = await sendOp(aa, ANVIL_EOA, encodeExecute(ENTRY_POINT, 0n, encodeWithdrawTo(EP_DEST, EP_SEND)), 1);
  const wd = (ep.rec.logs || []).find((l) => topic0(l) === WITHDRAWN_TOPIC.toLowerCase());
  const wdParsed = wd && parseWithdrawnData(wd.data);
  if (!wdParsed || wdParsed.amount !== EP_SEND) fail('Withdrawn log missing or amount mismatch');
  const epAfter = word(await jrpc(RPC, 'eth_getBalance', [EP_DEST, 'latest']));
  if (epAfter - epBefore !== EP_SEND) fail('prepaid gas not received');

  const rcvHash = await jrpc(RPC, 'eth_sendTransaction', [
    { from: ANVIL_EOA, to: aa, value: '0x' + (10n ** 16n).toString(16), data: '0x' },
  ]);
  const rcvRec = await waitReceipt(rcvHash);
  if (BigInt(rcvRec.status) === 0n) fail('plain ETH in reverted');
  const rcvLog = (rcvRec.logs || []).find((l) => topic0(l) === RECEIVED_TOPIC.toLowerCase());
  const rcvParsed = rcvLog && parseReceivedData(rcvLog.data);
  if (!rcvParsed || rcvParsed.amount !== 10n ** 16n) fail('Received log missing or amount mismatch');

  const fromBlock = await forkMinedFromBlock(RPC);
  const latest = Number(await jrpc(RPC, 'eth_blockNumber', []));
  const logs = await scanAccountLogs(fromBlock, latest, aa);
  if (!(logs.ops || []).some((l) => String(l.transactionHash).toLowerCase() === batch.txHash.toLowerCase())) {
    fail('scanAccountLogs missed batch UserOp');
  }
  if (!(logs.outs || []).some((l) => topic0(l) === TRANSFER_TOPIC.toLowerCase() && String(l.transactionHash).toLowerCase() === batch.txHash.toLowerCase())) {
    fail('scanAccountLogs missed ERC-20 out');
  }
  if (!(logs.wds || []).some((l) => String(l.transactionHash).toLowerCase() === ep.txHash.toLowerCase())) {
    fail('scanAccountLogs missed Withdrawn');
  }
  if (!(logs.rcv || []).some((l) => String(l.transactionHash).toLowerCase() === rcvHash.toLowerCase())) {
    fail('scanAccountLogs missed Received');
  }

  console.log('ok ops', batch.txHash, 'ep', ep.txHash, 'rcv', rcvHash, 'toy', toy);
}

main().catch((e) => fail(e.message || String(e)));
