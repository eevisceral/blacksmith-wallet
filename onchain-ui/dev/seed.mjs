import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCOUNT_FACTORY,
  ENTRY_POINT,
  KERNEL_FACTORY,
  encodeBalanceOf,
  encodeCreateAccount,
  encodeGetAccountAddress,
  hasCode,
  parseAmt,
  parseRpcJson,
} from '../kernel.mjs';

export const ANVIL_EOA = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const DEPOSIT_TO = '0xb760faf9';
const TRANSFER = '0xa9059cbb';
const USDC_WHALES = [
  '0x55FE002aeff02F77364de339a1292923A15844B8',
  '0x37305B1cD065C429e2CE4C9584852254d289635a',
  '0x28C6c06298d514Db089934071355E5743bf21d60',
];
const BINANCE = [
  '0xF977814e90dA44bFA03b6295A0616a897441aceC',
  '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503',
  '0x28C6c06298d514Db089934071355E5743bf21d60',
];

/** Mainnet tokens gifted via whale impersonation (skip if the whale is dry). */
const LIVE_GIFTS = [
  { addr: USDC, amount: 1000n * 10n ** 6n, whales: USDC_WHALES },
  { addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', amount: 2500n * 10n ** 6n, whales: BINANCE },
  { addr: '0x6B175474E89094C44Da98b954EedeAC495271d0F', amount: 800n * 10n ** 18n, whales: BINANCE },
  { addr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', amount: 3n * 10n ** 18n, whales: BINANCE },
  { addr: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', amount: 15n * 10n ** 6n, whales: BINANCE },
  { addr: '0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd', amount: 50n * 10n ** 2n, whales: BINANCE },
  { addr: '0x514910771AF9Ca656af840dff83E8264EcF986CA', amount: 40n * 10n ** 18n, whales: BINANCE },
  { addr: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', amount: 120n * 10n ** 18n, whales: BINANCE },
  { addr: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', amount: 420_690_000n * 10n ** 18n, whales: BINANCE },
  { addr: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', amount: 2n * 10n ** 18n, whales: BINANCE },
];

/** Deployed on the fork so every decimals() the UI accepts has a row. */
export const TOY_SPECS = [
  { name: 'Nil', symbol: 'NIL', decimals: 0, human: '7' },
  { name: 'Dime', symbol: 'DIME', decimals: 1, human: '12.5' },
  { name: 'Cent', symbol: 'CENT', decimals: 2, human: '99.99' },
  { name: 'Milli', symbol: 'MIL', decimals: 3, human: '1.001' },
  { name: 'Basis', symbol: 'BPS', decimals: 4, human: '0.0001' },
  { name: 'Five', symbol: 'FIVE', decimals: 5, human: '7.77777' },
  { name: 'Micro', symbol: 'MIC', decimals: 6, human: '0.000001' },
  { name: 'Seven', symbol: 'SEV', decimals: 7, human: '80' },
  { name: 'Satoshi', symbol: 'SAT', decimals: 8, human: '0.021' },
  { name: 'Gweiish', symbol: 'GWEI', decimals: 9, human: '1.5' },
  { name: 'Ten', symbol: 'TEN', decimals: 10, human: '42' },
  { name: 'Eleven', symbol: 'ELV', decimals: 11, human: '0.1' },
  { name: 'Twelve', symbol: 'TWL', decimals: 12, human: '123.456' },
  { name: 'Pi', symbol: 'PI', decimals: 15, human: '3.141592653589793' },
  { name: 'Dust', symbol: 'DUST', decimals: 18, human: '0.000000000000000001' },
  { name: 'Bag', symbol: 'BAG', decimals: 18, human: '1000000.5' },
  { name: 'A Very Long Token Name To Stress The Row', symbol: 'LONGNAME12X', decimals: 21, human: '0.5' },
  { name: 'Yocto', symbol: 'YOT', decimals: 24, human: '1.5' },
  { name: 'MaxDec', symbol: 'MAXD', decimals: 36, human: '1' },
];

const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(here, '../contracts');
const toyArtifact = join(contractsDir, 'out/ToyERC20.sol/ToyERC20.json');
const toySource = join(contractsDir, 'src/ToyERC20.sol');
const factoryArtifact = join(contractsDir, 'out/AccountFactory.sol/AccountFactory.json');
const factorySource = join(contractsDir, 'src/AccountFactory.sol');
const NICK_FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const FACTORY_SALT = '0x9489c07c9fd480ccf396b49b09017e980ab53f8ea5dc37c33dad9ff6dc8580c8';

let rpcId = 1;

export async function jrpc(rpc, method, params, ms = 30000) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
    signal: AbortSignal.timeout(ms),
  });
  const j = parseRpcJson(await r.text());
  if (j.error) throw new Error(j.error.message || method);
  return j.result;
}

function padAddr(a) {
  return a.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
}

function hex(n) {
  return '0x' + BigInt(n).toString(16);
}

function u256(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

function encodeAbiString(s) {
  const bytes = Buffer.from(s, 'utf8');
  const data = bytes.toString('hex');
  const pad = (64 - (data.length % 64)) % 64;
  return u256(bytes.length) + data + '0'.repeat(pad);
}

function encodeToyCtor(name, symbol, decimals, supply, to) {
  const nEnc = encodeAbiString(name);
  const sEnc = encodeAbiString(symbol);
  const head = 5 * 32;
  return (
    u256(head) +
    u256(head + nEnc.length / 2) +
    u256(decimals) +
    u256(supply) +
    padAddr(to) +
    nEnc +
    sEnc
  );
}

function factoryBytecode() {
  const stale =
    !existsSync(factoryArtifact) ||
    (existsSync(factorySource) && statSync(factorySource).mtimeMs > statSync(factoryArtifact).mtimeMs);
  if (stale) execFileSync('forge', ['build', '--skip', 'test', '--skip', 'script'], { cwd: contractsDir, stdio: 'inherit' });
  const art = JSON.parse(readFileSync(factoryArtifact, 'utf8'));
  const bin = art.bytecode?.object || art.bytecode;
  if (!bin || bin === '0x') throw new Error('AccountFactory bytecode missing — forge build failed');
  return String(bin).replace(/^0x/i, '');
}

export async function ensureAccountFactory(rpc) {
  const code = await jrpc(rpc, 'eth_getCode', [ACCOUNT_FACTORY, 'latest']);
  if (hasCode(code)) return ACCOUNT_FACTORY;
  const nick = await jrpc(rpc, 'eth_getCode', [NICK_FACTORY, 'latest']);
  if (!hasCode(nick)) throw new Error('Nick CREATE2 factory missing on this RPC');
  await send(rpc, {
    from: ANVIL_EOA,
    to: NICK_FACTORY,
    data: FACTORY_SALT + factoryBytecode(),
    value: '0x0',
  });
  const after = await jrpc(rpc, 'eth_getCode', [ACCOUNT_FACTORY, 'latest']);
  if (!hasCode(after)) throw new Error('AccountFactory CREATE2 missed the pinned address — rebuild and update ACCOUNT_FACTORY');
  return ACCOUNT_FACTORY;
}

function toyBytecode() {
  const stale =
    !existsSync(toyArtifact) || (existsSync(toySource) && statSync(toySource).mtimeMs > statSync(toyArtifact).mtimeMs);
  if (stale) execFileSync('forge', ['build', '--skip', 'test', '--skip', 'script'], { cwd: contractsDir, stdio: 'inherit' });
  const art = JSON.parse(readFileSync(toyArtifact, 'utf8'));
  const bin = art.bytecode?.object || art.bytecode;
  if (!bin || bin === '0x') throw new Error('ToyERC20 bytecode missing — forge build failed');
  return String(bin).replace(/^0x/i, '');
}

async function send(rpc, tx) {
  const hash = await jrpc(rpc, 'eth_sendTransaction', [tx]);
  for (let i = 0; i < 40; i++) {
    try {
      const rec = await jrpc(rpc, 'eth_getTransactionReceipt', [hash]);
      if (rec) {
        if (BigInt(rec.status) === 0n) throw new Error('tx reverted ' + hash);
        return rec;
      }
    } catch (e) {
      // Base publicnode 403s archive receipt lookups; Anvil has the local receipt a tick later.
      if (!/403|Archive|Fork Error/i.test(e.message || '')) throw e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no receipt ' + hash);
}

export async function waitForRpc(rpc, tries = 180, want = '0x1') {
  const exp = String(want).toLowerCase();
  for (let i = 0; i < tries; i++) {
    try {
      const id = await jrpc(rpc, 'eth_chainId', [], 2000);
      if (String(id).toLowerCase() === exp) return;
      throw new Error('fork chainId is ' + id + ' (want ' + exp + ')');
    } catch (e) {
      if (/want 0x/.test(e.message || '')) throw e;
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** First block Anvil mined after the fork snapshot (seed txs live here). */
export async function forkMinedFromBlock(rpc) {
  let forkAt = 0;
  try {
    const info = await jrpc(rpc, 'anvil_nodeInfo', []);
    const n = info?.forkConfig?.forkBlockNumber;
    if (n != null && n !== '') {
      forkAt = Number(typeof n === 'string' && String(n).startsWith('0x') ? parseInt(n, 16) : n);
    }
  } catch {
    /* older anvil */
  }
  const latest = Number(await jrpc(rpc, 'eth_blockNumber', []));
  if (forkAt > 0) return Math.min(forkAt + 1, latest);
  return Math.max(0, latest - 8);
}

async function giftToken(rpc, dest, token, amount, whales) {
  const have = BigInt(await jrpc(rpc, 'eth_call', [{ to: token, data: encodeBalanceOf(dest) }, 'latest']));
  if (have >= amount) return true;
  const need = amount - have;
  for (const whale of whales) {
    try {
      const bal = BigInt(await jrpc(rpc, 'eth_call', [{ to: token, data: encodeBalanceOf(whale) }, 'latest']));
      if (bal < need) continue;
      await jrpc(rpc, 'anvil_impersonateAccount', [whale]);
      await jrpc(rpc, 'anvil_setBalance', [whale, hex(10n ** 18n)]);
      await send(rpc, {
        from: whale,
        to: token,
        data: TRANSFER + padAddr(dest) + hex(need).slice(2).padStart(64, '0'),
        value: '0x0',
      });
      await jrpc(rpc, 'anvil_stopImpersonatingAccount', [whale]);
      return true;
    } catch {
      try {
        await jrpc(rpc, 'anvil_stopImpersonatingAccount', [whale]);
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

async function deployToys(rpc, dest) {
  const bin = toyBytecode();
  const addrs = [];
  for (const spec of TOY_SPECS) {
    const supply = parseAmt(spec.human, spec.decimals);
    const rec = await send(rpc, {
      from: ANVIL_EOA,
      data: '0x' + bin + encodeToyCtor(spec.name, spec.symbol, spec.decimals, supply, dest),
    });
    const addr = rec.contractAddress;
    if (!addr) throw new Error('ToyERC20 create missing contractAddress');
    addrs.push(addr);
  }
  return addrs;
}

export async function seedFork(rpc) {
  await ensureAccountFactory(rpc);
  const raw = await jrpc(rpc, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(ANVIL_EOA) }, 'latest']);
  const aa = '0x' + String(raw).slice(-40);
  const code = await jrpc(rpc, 'eth_getCode', [aa, 'latest']);
  const deployed = !!(code && code !== '0x' && code !== '0x0');
  if (!deployed) {
    await send(rpc, {
      from: ANVIL_EOA,
      to: KERNEL_FACTORY,
      data: encodeCreateAccount(ANVIL_EOA),
      value: '0x0',
    });
  }

  await jrpc(rpc, 'anvil_setBalance', [aa, hex(12_345n * 10n ** 15n)]);
  await jrpc(rpc, 'anvil_setBalance', [ANVIL_EOA, hex(100n * 10n ** 18n)]);

  const dep = BigInt(await jrpc(rpc, 'eth_call', [{ to: ENTRY_POINT, data: encodeBalanceOf(aa) }, 'latest']));
  if (dep < 10n ** 16n) {
    await send(rpc, {
      from: ANVIL_EOA,
      to: ENTRY_POINT,
      data: DEPOSIT_TO + padAddr(aa),
      value: hex(5n * 10n ** 16n),
    });
  }

  const live = [];
  const cid = Number(await jrpc(rpc, 'eth_chainId', []));
  if (cid === 1) {
    for (const g of LIVE_GIFTS) {
      if (await giftToken(rpc, aa, g.addr, g.amount, g.whales)) live.push(g.addr);
    }
  }

  const toys = await deployToys(rpc, aa);

  const eth = BigInt(await jrpc(rpc, 'eth_getBalance', [aa, 'latest']));
  const ep = BigInt(await jrpc(rpc, 'eth_call', [{ to: ENTRY_POINT, data: encodeBalanceOf(aa) }, 'latest']));
  let usdc = 0n;
  try {
    usdc = BigInt(await jrpc(rpc, 'eth_call', [{ to: USDC, data: encodeBalanceOf(aa) }, 'latest']));
  } catch {
    /* Base has no ETH USDC at this address */
  }
  const tokens = [...new Set([...live, ...toys].map((a) => a.toLowerCase()))];
  return { aa, eth, ep, usdc, usdcOk: usdc > 0n, created: !deployed, tokens, toys, chainId: cid };
}
