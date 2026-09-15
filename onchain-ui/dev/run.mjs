#!/usr/bin/env node
/** Local fork playground: one Anvil (Ethereum 1 or Base 8453) + onchain-ui. */
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANVIL_EOA, jrpc, seedFork, waitForRpc, forkMinedFromBlock } from './seed.mjs';
import { serveUiRoot } from './serve.mjs';
import { CHAINS } from '../kernel.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const uiRoot = resolve(here, '..');
const FORK_PORT = Number(process.env.FORK_PORT || 8545);
const UI_PORT = Number(process.env.ONCHAIN_UI_PORT || 8765);
const forkRpc = `http://127.0.0.1:${FORK_PORT}`;
const uiOrigin = `http://127.0.0.1:${UI_PORT}`;
const ETH_RPCS = CHAINS[1].rpcs;
const BASE_RPCS = CHAINS[8453].rpcs;

function forkChain() {
  const a = String(process.env.FORK_CHAIN || process.argv[2] || '1').toLowerCase();
  return a === '8453' || a === 'base' ? 8453 : 1;
}

function forkUrls(chain) {
  if (chain === 8453) {
    const pinned = process.env.BASE_RPC_URL || process.env.BASE_RPC;
    return pinned ? [pinned] : BASE_RPCS;
  }
  const pinned = process.env.ETH_RPC_URL || process.env.MAINNET_RPC_URL;
  return pinned ? [pinned] : ETH_RPCS;
}

async function forkBlock(url) {
  if (process.env.FORK_BLOCK) return Number(process.env.FORK_BLOCK);
  const latest = Number(await jrpc(url, 'eth_blockNumber', [], 15000));
  // public nodes 400/timeout on exact head; 64-block lag is enough for a playground.
  return Math.max(0, latest - 64);
}

const kids = [];
let forkPage = null;

function spawnLogged(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
  kids.push(child);
  child.on('error', (e) => {
    if (e.code === 'ENOENT') console.error(cmd, 'not found — install Foundry (anvil)');
  });
  child.on('exit', (code, sig) => {
    if (code && code !== 0) console.error(cmd, 'exited', code || sig);
  });
  return child;
}

function shutdown(code = 0) {
  for (const c of kids) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  process.exit(typeof code === 'number' ? code : 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function patchIndex(html, fork) {
  const rpcKey = fork.chainId === '0x2105' ? 'v1w-rpc-8453' : 'v1w-rpc-1';
  const inject = `<script>window.__V1_FORK__=${JSON.stringify(fork)};localStorage.setItem('${rpcKey}', window.__V1_FORK__.rpc);</script>
<script src="/dev/injected-wallet.js"></script>
`;
  const src = '<script type="module" src="./app.mjs"></script>';
  if (html.includes(src)) return html.replace(src, `${inject}${src}`);
  const tag = '<script type="module">';
  const i = html.indexOf(tag);
  return i === -1 ? html : html.slice(0, i) + inject + html.slice(i);
}

function serveUi() {
  return serveUiRoot({
    uiRoot,
    port: UI_PORT,
    host: '127.0.0.1',
    patchIndexHtml: (html) => patchIndex(html, forkPage),
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' }, () => {
      s.end();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });
}

async function main() {
  const chain = forkChain();
  const wantHex = chain === 8453 ? '0x2105' : '0x1';
  const label = chain === 8453 ? 'Base' : 'Ethereum';
  if (await portOpen(FORK_PORT)) {
    console.log('reusing existing process on', forkRpc);
    await waitForRpc(forkRpc, 8, wantHex);
  } else {
    let lastErr;
    for (const url of forkUrls(chain)) {
      let block;
      try {
        block = await forkBlock(url);
      } catch (e) {
        lastErr = e;
        console.error('cannot read', url, '-', e.message || e);
        continue;
      }
      console.log('starting anvil fork of', label, '→', url, '@', block);
      const child = spawnLogged(
        'anvil',
        [
          '--fork-url',
          url,
          '--fork-block-number',
          String(block),
          '--chain-id',
          String(chain),
          '--accounts',
          '20',
          '--port',
          String(FORK_PORT),
          '--gas-limit',
          '60000000',
        ],
        { cwd: uiRoot }
      );
      let booted = false;
      const died = new Promise((_, reject) => {
        child.once('exit', (code, sig) => {
          if (!booted) reject(new Error('anvil exited ' + (code || sig)));
        });
      });
      try {
        await Promise.race([waitForRpc(forkRpc, 180, wantHex), died]);
        booted = true;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        for (let i = 0; i < 20 && (await portOpen(FORK_PORT)); i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
    if (lastErr) throw lastErr;
  }
  const seeded = await seedFork(forkRpc);
  forkPage = {
    rpc: forkRpc,
    eoa: ANVIL_EOA,
    chainId: wantHex,
    tokens: seeded.tokens,
    fromBlock: await forkMinedFromBlock(forkRpc),
  };
  await serveUi();

  console.log(`
Local fork is up.

  Anvil RPC     ${forkRpc}   chainId ${chain} (${label})
  Wallet UI     ${uiOrigin}/

  EOA           ${ANVIL_EOA}
  Kernel        ${seeded.aa}  ${seeded.created ? '(created on fork)' : '(already deployed)'}
  Kernel ETH    ${seeded.eth} wei
  EP deposit    ${seeded.ep} wei
  USDC          ${seeded.usdc}  ${seeded.usdcOk ? '' : '(whale transfer skipped)'}
  Seeded ERC-20 ${seeded.tokens.length}  (${chain === 1 ? 'mainnet gifts + ' : ''}ToyERC20 across decimals 0–36)

Open the wallet UI, Connect — the token list should fill without pasting.
`);
}

main().catch((e) => {
  console.error(e);
  shutdown(1);
});
