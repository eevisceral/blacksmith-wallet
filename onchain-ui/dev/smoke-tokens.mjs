#!/usr/bin/env node
/** Fork check: seeded ERC-20s are on the Kernel; USDC is still 6-decimal USD Coin. */
import { KERNEL_FACTORY, encodeGetAccountAddress, encodeBalanceOf } from '../kernel.mjs';
import { ANVIL_EOA, USDC, TOY_SPECS, jrpc, waitForRpc } from './seed.mjs';

const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';

function fail(reason) {
  console.error('FAIL', reason);
  process.exit(1);
}

async function decimalsOf(addr) {
  const decRaw = await jrpc(RPC, 'eth_call', [{ to: addr, data: '0x313ce567' }, 'latest']);
  return Number(BigInt(decRaw && decRaw !== '0x' ? decRaw : '0x0'));
}

async function main() {
  try {
    await waitForRpc(RPC, 4);
  } catch {
    fail('start node onchain-ui/dev/run.mjs first');
  }

  const raw = await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(ANVIL_EOA) }, 'latest']);
  const kernel = '0x' + String(raw).slice(-40);

  const usdcBal = BigInt(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(kernel) }, 'latest']));
  if (usdcBal === 0n) fail('USDC balanceOf(kernel) is 0');
  const nameRaw = await jrpc(RPC, 'eth_call', [{ to: USDC, data: '0x06fdde03' }, 'latest']);
  if (!/55534420436f696e/i.test(String(nameRaw))) fail('USDC name want USD Coin');
  if ((await decimalsOf(USDC)) !== 6) fail('USDC decimals want 6');

  const page = await fetch('http://127.0.0.1:8765/').then((r) => r.text());
  const m = page.match(/window\.__V1_FORK__=(\{.*?\});/);
  if (!m) fail('fork page missing __V1_FORK__');
  const fork = JSON.parse(m[1]);
  const addrs = (fork.tokens || []).map((a) => String(a).toLowerCase());
  if (addrs.length < 15) fail('want ≥15 seeded tokens, got ' + addrs.length);
  if (!addrs.includes(USDC.toLowerCase())) fail('USDC missing from seeded token list');

  const decs = new Set();
  let held = 0;
  for (const a of addrs) {
    const bal = BigInt(await jrpc(RPC, 'eth_call', [{ to: a, data: encodeBalanceOf(kernel) }, 'latest']));
    if (bal > 0n) held++;
    decs.add(await decimalsOf(a));
  }
  if (held < 15) fail('want ≥15 tokens with balance, got ' + held);
  for (const d of new Set(TOY_SPECS.map((s) => s.decimals))) {
    if (!decs.has(d)) fail('missing decimals ' + d + ' in ' + [...decs].sort((a, b) => a - b));
  }

  console.log('ok', held, 'tokens', 'decimals', [...decs].sort((a, b) => a - b).join(','));
}

main().catch((e) => fail(e.message || String(e)));
