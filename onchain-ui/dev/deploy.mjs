#!/usr/bin/env node
/**
 * Simulate (default) or broadcast AccountFactory + VersionHost via forge script.
 * Signs locally. The RPC only sees eth_sendRawTransaction of signed bytes.
 * This wrapper never forwards a raw private key.
 *
 *   ETH_RPC=https://… node onchain-ui/dev/deploy.mjs
 *   BASE_RPC=https://… node onchain-ui/dev/deploy.mjs --chain base
 *   ETH_RPC=https://… node onchain-ui/dev/deploy.mjs --broadcast --account deployer
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jrpc } from '../rpc.mjs';
import { keccak256 } from '../../mcp/eth-crypto.mjs';
import { checkRecords, checkDist } from './pin-check.mjs';
import { loadRepoEnv } from './env.mjs';

const KEY_FLAGS = ['--private-key', '--private-keys', '--mnemonic', '--mnemonic-passphrase', '--mnemonic-derivation-path'];
const KEY_ENV = ['FOUNDRY_ETH_PRIVATE_KEY', 'ETH_PRIVATE_KEY', 'PRIVATE_KEY', 'MNEMONIC'];

export function refuseDeploySecrets(argv, env = process.env) {
  for (const a of argv) {
    const low = String(a).toLowerCase();
    for (const f of KEY_FLAGS) {
      if (low === f || low.startsWith(f + '=')) {
        return `Do not pass ${f}. Sign from a Foundry keystore (--account). The RPC never needs the key; putting it on the command line leaks it to your shell and process list.`;
      }
    }
    if (/^[0-9a-f]{64}$/i.test(String(a).replace(/^0x/i, ''))) {
      return 'Do not pass a 64-hex private key as an argument. Use --account with a Foundry keystore.';
    }
  }
  for (const k of KEY_ENV) {
    if (env[k]) {
      return `Unset ${k}. This wrapper does not send a raw key to Foundry. Import the key into a Foundry keystore and pass --account.`;
    }
  }
  return '';
}

export function parseDeployArgs(argv) {
  let broadcast = false;
  let chain = 1;
  let account = '';
  const extra = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--broadcast') {
      broadcast = true;
      continue;
    }
    if (a === '--chain') {
      chain = normChain(argv[++i]);
      continue;
    }
    if (a.startsWith('--chain=')) {
      chain = normChain(a.slice(8));
      continue;
    }
    if (a === '--account') {
      account = String(argv[++i] || '').trim();
      continue;
    }
    if (a.startsWith('--account=')) {
      account = a.slice(10).trim();
      continue;
    }
    extra.push(a);
  }
  return { broadcast, chain, account, extra };
}

export function normChain(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (s === '1' || s === 'ethereum' || s === 'eth' || s === 'mainnet') return 1;
  if (s === '8453' || s === 'base') return 8453;
  throw new Error('chain must be 1 (Ethereum) or 8453 (Base).');
}

export function rpcForChain(chain, env = process.env) {
  const url = String(chain === 8453 ? env.BASE_RPC || '' : env.ETH_RPC || '').trim();
  if (!url) {
    const name = chain === 8453 ? 'BASE_RPC' : 'ETH_RPC';
    return { error: `${name} must be set. This path does not walk the public snapshot (a signed tx would hit a random node).` };
  }
  return { url };
}

export function forgeArgs({ broadcast, chain, account, extra, rpcUrl }) {
  const args = [
    'script',
    'script/Deploy.s.sol:Deploy',
    '--rpc-url',
    rpcUrl,
    '--chain-id',
    String(chain),
    '--slow',
  ];
  if (broadcast) {
    if (!account) {
      return { error: 'Broadcast needs --account <keystore name>. Do not use --private-key.' };
    }
    args.push('--broadcast', '--account', account);
  }
  args.push(...extra);
  return { args, chain };
}

function hasCode(hex) {
  const s = String(hex || '').replace(/^0x/i, '');
  return s !== '' && s !== '0';
}

function htmlSelector() {
  return keccak256(Buffer.from('html()')).slice(0, 10);
}

function abiString(hex) {
  const h = String(hex || '').replace(/^0x/i, '');
  if (h.length < 128) throw new Error('short html() return');
  const off = Number.parseInt(h.slice(0, 64), 16) * 2;
  const len = Number.parseInt(h.slice(off, off + 64), 16);
  return Buffer.from(h.slice(off + 64, off + 64 + len * 2), 'hex').toString('utf8');
}

/** Live RPC must match the intended chain and already hold Nick/Kernel/EntryPoint. */
export async function preflight({ chain, rpcUrl, broadcast }) {
  const pin = checkRecords();
  const dist = checkDist(pin);
  const cidHex = await jrpc(rpcUrl, 'eth_chainId', [], 12000);
  const cid = Number(cidHex);
  if (cid !== Number(chain)) {
    return { error: `RPC chainId ${cid} does not match --chain ${chain}. Wrong network. Abort.` };
  }
  const need = [
    ['Nick CREATE2 factory', pin.nick],
    ['Kernel implementation', pin.impl],
    ['ECDSA validator', pin.validator],
    ['EntryPoint', pin.entryPoint],
  ];
  for (const [name, addr] of need) {
    const code = await jrpc(rpcUrl, 'eth_getCode', [addr, 'latest'], 12000);
    if (!hasCode(code)) return { error: `${name} has no code at ${addr} on chain ${chain}. Abort.` };
  }
  const factoryCode = await jrpc(rpcUrl, 'eth_getCode', [pin.factory, 'latest'], 12000);
  const hostCode = await jrpc(rpcUrl, 'eth_getCode', [pin.host, 'latest'], 12000);
  const factoryOn = hasCode(factoryCode);
  const hostOn = hasCode(hostCode);
  if (hostOn) {
    const ret = await jrpc(rpcUrl, 'eth_call', [{ to: pin.host, data: htmlSelector() }, 'latest'], 20000);
    const served = abiString(ret);
    const k = keccak256(Buffer.from(served)).toLowerCase();
    if (k !== pin.keccak) {
      return { error: `Host ${pin.host} is live but html() keccak ${k} != freeze ${pin.keccak}. Abort.` };
    }
    if (broadcast) {
      return {
        skip: true,
        pin,
        dist,
        factoryOn,
        hostOn,
        message: `VersionHost already live on chain ${chain} with this freeze. Not broadcasting.`,
      };
    }
  }
  return { pin, dist, factoryOn, hostOn, skip: false };
}

async function main() {
  loadRepoEnv();
  const argv = process.argv.slice(2);
  const secret = refuseDeploySecrets(argv, process.env);
  if (secret) {
    console.error(secret);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = parseDeployArgs(argv);
  } catch (e) {
    console.error(e.message || e);
    process.exit(2);
  }
  const rpc = rpcForChain(parsed.chain, process.env);
  if (rpc.error) {
    console.error(rpc.error);
    process.exit(2);
  }
  const built = forgeArgs({ ...parsed, rpcUrl: rpc.url });
  if (built.error) {
    console.error(built.error);
    process.exit(2);
  }
  let pf;
  try {
    pf = await preflight({ chain: parsed.chain, rpcUrl: rpc.url, broadcast: parsed.broadcast });
  } catch (e) {
    console.error('Preflight failed:', e.message || e);
    process.exit(2);
  }
  if (pf.error) {
    console.error(pf.error);
    process.exit(2);
  }
  console.error(
    'Preflight ok',
    'keccak',
    pf.dist.keccak,
    'factory',
    pf.factoryOn ? 'live' : 'empty',
    'host',
    pf.hostOn ? 'live' : 'empty',
  );
  if (pf.skip) {
    console.error(pf.message);
    process.exit(0);
  }
  if (parsed.broadcast) {
    console.error('Broadcasting Deploy.run on chain', parsed.chain, 'via', rpc.url);
    console.error('The node receives signed raw transactions only. Abort now if that is not what you meant.');
  } else {
    console.error('Simulate only (no --broadcast). chain', parsed.chain);
  }
  const contracts = join(dirname(fileURLToPath(import.meta.url)), '../contracts');
  const r = spawnSync('forge', built.args, { cwd: contracts, stdio: 'inherit' });
  process.exit(r.status === 0 ? 0 : r.status || 1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
