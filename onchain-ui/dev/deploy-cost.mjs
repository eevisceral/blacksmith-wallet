#!/usr/bin/env node
/**
 * Quote AccountFactory + VersionHost CREATE2 (factory + chunks + host) on Ethereum + Base right now.
 * Uses the last forge-script gas-limit sum (conservative vs live gasUsed).
 * BEST < $2  GOOD < $5  PASS otherwise (exit 1).
 *
 *   node onchain-ui/dev/deploy-cost.mjs
 *   npm run quote:deploy
 *   ETH_RPC=… BASE_RPC=… ETH_USD=2500 node onchain-ui/dev/deploy-cost.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAINS } from '../kernel.mjs';
import { jrpc } from '../rpc.mjs';

const GAS = 26_928_640n; // forge script Deploy.s.sol limit sum (ETH+Base simulate 2026-08-18)
const BEST = 2;
const GOOD = 5;
const ORACLE = '0x420000000000000000000000000000000000000F';
const ENV_RPC = { 1: process.env.ETH_RPC, 8453: process.env.BASE_RPC };
const freezePath = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');

const money = (n) => '$' + n.toFixed(2);
const ethOf = (wei) => Number(wei) / 1e18;
const usdOf = (wei, px) => ethOf(wei) * px;

function gwei(wei) {
  const s = (Number(wei) / 1e9).toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
}

async function firstRpc(id, method, params, ms = 8000) {
  const urls = [ENV_RPC[id], ...(CHAINS[id]?.rpcs || [])].filter(Boolean);
  let last;
  for (const url of urls) {
    try {
      return await jrpc(url, method, params, ms);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error(`no RPC for chain ${id}`);
}

async function paidGasWei(id) {
  try {
    const [block, tipHex] = await Promise.all([
      firstRpc(id, 'eth_getBlockByNumber', ['latest', false]),
      firstRpc(id, 'eth_maxPriorityFeePerGas', []),
    ]);
    const base = BigInt(block.baseFeePerGas || '0x0');
    const tip = BigInt(tipHex || '0x0');
    if (base) return base + tip;
  } catch {
    /* fall through */
  }
  return BigInt(await firstRpc(id, 'eth_gasPrice', []));
}

function encodeGetL1Fee(buf) {
  const n = buf.length;
  const off = '0'.repeat(62) + '20';
  const len = n.toString(16).padStart(64, '0');
  const body = Buffer.from(buf).toString('hex');
  const pad = (64 - (body.length % 64)) % 64;
  return '0x49948e0e' + off + len + body + '0'.repeat(pad);
}

/** Base L1 data fee for freeze-sized CREATE2 calldata + 4 extra tx overheads. */
async function baseL1Wei(buf) {
  const fee = (b) =>
    firstRpc(8453, 'eth_call', [{ to: ORACLE, data: encodeGetL1Fee(b) }, 'latest'], 20000).then(BigInt);
  const [empty, page] = await Promise.all([fee(Buffer.alloc(0)), fee(buf)]);
  return page + empty * 4n;
}

async function ethUsd() {
  if (process.env.ETH_USD) return Number(process.env.ETH_USD);
  const r = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`ETH-USD HTTP ${r.status}`);
  const n = Number((await r.json()).data?.amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('ETH-USD missing');
  return n;
}

function line(name, gweiWei, wei, px, extra = '') {
  const eth = ethOf(wei).toFixed(6).padStart(10);
  return `${name.padEnd(10)}${gwei(gweiWei).padStart(8)} gwei  ${eth} ETH  ${money(usdOf(wei, px))}${extra}`;
}

const usd = await ethUsd();
const [ethGwei, baseGwei] = await Promise.all([paidGasWei(1), paidGasWei(8453)]);
const ethWei = GAS * ethGwei;
const baseExecWei = GAS * baseGwei;
let baseL1 = 0n;
if (existsSync(freezePath)) {
  try {
    baseL1 = await baseL1Wei(readFileSync(freezePath));
  } catch (e) {
    console.error('Base L1 data fee skipped:', e.message || e);
  }
}
const baseWei = baseExecWei + baseL1;
const totalWei = ethWei + baseWei;
const totalUsd = usdOf(totalWei, usd);
const tag = totalUsd < BEST ? 'BEST' : totalUsd < GOOD ? 'GOOD' : 'PASS';

console.log(`VersionHost deploy  ${GAS.toLocaleString()} gas × Ethereum + Base`);
console.log(`ETH ${money(usd)}   forge-limit sum (conservative vs live gasUsed)`);
console.log('');
console.log(line('Ethereum', ethGwei, ethWei, usd));
console.log(
  line(
    'Base',
    baseGwei,
    baseWei,
    usd,
    baseL1 ? `  (exec ${money(usdOf(baseExecWei, usd))} + L1 data ${money(usdOf(baseL1, usd))})` : '',
  ),
);
console.log('─'.repeat(58));
console.log(
  `Total                          ${ethOf(totalWei).toFixed(6).padStart(10)} ETH  ${money(totalUsd)}  ${tag}`,
);
console.log('');
console.log(tag === 'BEST' ? 'Go — under $2.' : tag === 'GOOD' ? 'Fine — under $5.' : 'Wait — over $5.');

process.exit(tag === 'PASS' ? 1 : 0);
