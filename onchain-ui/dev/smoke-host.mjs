#!/usr/bin/env node
/** Local fork only: broadcast VersionHost, html() === freeze, 5219 request, hosted page Connect. */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KERNEL_FACTORY, encodeGetAccountAddress, pageHostFromLocation } from '../kernel.mjs';
import { ANVIL_EOA, jrpc, waitForRpc, forkMinedFromBlock } from './seed.mjs';
import { serveHtml } from './serve.mjs';
import { chromeBin, chromeArgs } from './chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..');
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const HOST_UI_PORT = Number(process.env.HOST_UI_PORT || 0);
const CHROME = chromeBin();
const REUSE = process.env.REUSE_HOST === '1';

function fail(reason) {
  console.error('FAIL', reason);
  process.exit(1);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000,
    ...opts,
  });
  if (r.error) fail(r.error.message || `${cmd} failed`);
  if (r.status !== 0) fail((r.stderr || r.stdout || `${cmd} failed`).slice(0, 4000));
  return r.stdout || '';
}

function keccakUtf8(buf) {
  return sh('cast', ['keccak'], { input: buf, timeout: 15000 }).trim();
}

function decodePackedString(h, off) {
  const len = Number(BigInt('0x' + h.slice(off * 2, off * 2 + 64)));
  const data = h.slice(off * 2 + 64, off * 2 + 64 + len * 2);
  if (!Number.isFinite(len) || len < 0 || data.length !== len * 2) {
    fail('abi string length mismatch declared ' + len + ' have ' + data.length / 2 + ' (hex ' + h.length / 2 + ' B)');
  }
  return Buffer.from(data, 'hex');
}

function decodeAbiString(hex) {
  const h = String(hex || '').replace(/^0x/i, '');
  if (h.length < 128) fail('abi string too short (' + h.length + ' nybbles)');
  const off = Number(BigInt('0x' + h.slice(0, 64)));
  return decodePackedString(h, off);
}

function chunkInitcode(data) {
  if (data.length > 24576) fail('chunk too large');
  if (data.length && data[0] === 0xef) fail('EIP-3541');
  const header = Buffer.from('61' + data.length.toString(16).padStart(4, '0') + '80600A5F395FF3', 'hex');
  return '0x' + Buffer.concat([header, data]).toString('hex');
}

const HOST_DEPLOYER = '0xabc0000000000000000000000000000000000abc';

async function sendCreate(data) {
  await jrpc(RPC, 'anvil_setBalance', [HOST_DEPLOYER, '0x56bc75e2d63100000']);
  await jrpc(RPC, 'anvil_impersonateAccount', [HOST_DEPLOYER]);
  const hash = await jrpc(RPC, 'eth_sendTransaction', [{ from: HOST_DEPLOYER, data, gas: '0x7a1200' }]);
  for (let i = 0; i < 40; i++) {
    const rec = await jrpc(RPC, 'eth_getTransactionReceipt', [hash]);
    if (rec) {
      if (BigInt(rec.status) === 0n) fail('create reverted ' + hash);
      if (!rec.contractAddress) fail('create missing address ' + hash);
      return rec.contractAddress;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail('no receipt ' + hash);
}

async function deployHost(dist, n, contractsDir) {
  const artifact = join(contractsDir, 'out/VersionHost.sol/VersionHost.json');
  if (!existsSync(artifact)) {
    sh('forge', ['build', '--skip', 'test', '--skip', 'script'], { cwd: contractsDir, timeout: 120000 });
  }
  const bin = String(JSON.parse(readFileSync(artifact, 'utf8')).bytecode?.object || '').replace(/^0x/i, '');
  if (!bin) fail('VersionHost bytecode missing — forge build');
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const part = dist.subarray(i * 24576, Math.min(dist.length, (i + 1) * 24576));
    const addr = await sendCreate(chunkInitcode(part));
    console.log('chunk', i, addr, part.length, 'B');
    chunks.push(addr);
  }
  const args = sh(
    'cast',
    ['abi-encode', 'constructor(address[])', '[' + chunks.join(',') + ']'],
    { timeout: 15000 }
  )
    .trim()
    .replace(/^0x/i, '');
  const host = await sendCreate('0x' + bin + args);
  return { host, chunks };
}

function injectHosted(html, fork) {
  const wallet = readFileSync(join(here, 'injected-wallet.js'), 'utf8');
  const boot = `<script>window.__V1_FORK__=${JSON.stringify(fork)};try{localStorage.setItem('v1w-rpc-1',window.__V1_FORK__.rpc)}catch{}</script><script>${wallet}</script><script>
window.addEventListener('load',async()=>{
  const b=document.getElementById('connectLand');
  if(b && !document.body.classList.contains('on')) b.click();
  for(let i=0;i<80;i++){
    await new Promise(r=>setTimeout(r,250));
    const el=document.getElementById('aa');
    const aa=(el?.title||el?.textContent||'').trim();
    const eth=(document.getElementById('ethBal')?.textContent||'').trim();
    if(/^0x[a-fA-F0-9]{40}$/.test(aa) && eth && eth!=='-'){
      const nTok=document.getElementById('tokens')?.querySelectorAll('.tok').length||0;
      document.documentElement.setAttribute('data-host-smoke',aa.toLowerCase());
      document.documentElement.setAttribute('data-host-eth',eth);
      document.documentElement.setAttribute('data-host-ep',(document.getElementById('epBal')?.textContent||'').trim());
      document.documentElement.setAttribute('data-host-tokens',String(nTok));
      document.documentElement.setAttribute('data-host-on',document.body.classList.contains('on')?'1':'0');
      if(nTok>0 || i>40) return;
    }
    const note=(document.getElementById('note')?.textContent||'').trim();
    if(note) document.documentElement.setAttribute('data-host-err',note.slice(0,240));
  }
  const el=document.getElementById('aa');
  document.documentElement.setAttribute('data-host-smoke','timeout');
  document.documentElement.setAttribute('data-host-err',[
    document.getElementById('note')?.textContent||'',
    'on='+document.body.classList.contains('on'),
    'aa='+(el?.title||el?.textContent||''),
    'eth='+(document.getElementById('ethBal')?.textContent||''),
  ].join('|').slice(0,240));
});
</script>`;
  if (!html.includes('<script type="module">')) fail('hosted html missing inlined module');
  return html.replace('<script type="module">', () => `${boot}<script type="module">`);
}

async function chromeProbe(origin, profile) {
  const dbg = Number(process.env.HOST_CDP_PORT || 9333);
  const child = spawn(
    CHROME,
    chromeArgs([
      `--remote-debugging-port=${dbg}`,
      `--user-data-dir=${profile}`,
      origin + '/',
    ]),
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const expr = `(() => {
    const g = (k) => document.documentElement.getAttribute(k) || '';
    const aa = g('data-host-smoke');
    if (!aa) return null;
    return {
      aa,
      eth: g('data-host-eth'),
      ep: g('data-host-ep'),
      tokens: g('data-host-tokens'),
      on: g('data-host-on'),
      err: g('data-host-err'),
    };
  })()`;
  try {
    let wsUrl = '';
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      try {
        const pages = await fetch('http://127.0.0.1:' + dbg + '/json/list', { signal: AbortSignal.timeout(500) }).then((r) => r.json());
        const want = origin + '/';
        const page = (pages || []).find(
          (p) => p.type === 'page' && p.webSocketDebuggerUrl && String(p.url || '').startsWith(origin)
        );
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {
        /* chrome not listening yet */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!wsUrl) fail('chrome DevTools not listening on ' + dbg);
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('cdp websocket failed')));
    });
    let n = 0;
    const send = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++n;
        const onmsg = (ev) => {
          const msg = JSON.parse(String(ev.data));
          if (msg.id !== id) return;
          ws.removeEventListener('message', onmsg);
          if (msg.error) reject(new Error(msg.error.message || method));
          else resolve(msg.result);
        };
        ws.addEventListener('message', onmsg);
        ws.send(JSON.stringify({ id, method, params }));
      });
    await send('Runtime.enable');
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      const v = r?.result?.value;
      if (v && v.aa) return v;
      await new Promise((x) => setTimeout(x, 300));
    }
    fail('hosted Connect timed out (no data-host-smoke)');
  } finally {
    child.kill('SIGKILL');
  }
}

async function playgroundFork() {
  try {
    const page = await fetch('http://127.0.0.1:8765/', { signal: AbortSignal.timeout(2000) }).then((r) => r.text());
    const m = page.match(/window\.__V1_FORK__=(\{.*?\});/);
    if (m) return JSON.parse(m[1]);
  } catch {
    /* playground optional for Connect; tokens list is better with it */
  }
  return null;
}

async function main() {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d+$/i.test(RPC)) {
    fail('smoke-host only broadcasts to a local RPC (got ' + RPC + ')');
  }
  try {
    await waitForRpc(RPC, 8);
  } catch {
    fail('start node onchain-ui/dev/run.mjs first');
  }
  const chain = Number(await jrpc(RPC, 'eth_chainId', []));
  if (chain !== 1) fail('fork chainId want 1 got ' + chain);

  const distPath = join(uiRoot, 'dist/index.html');
  const dist = readFileSync(distPath);
  const freezeKeccak = keccakUtf8(dist);
  const n = Math.ceil(dist.length / 24576);
  if (n < 1 || n > 16) fail('dist splits into ' + n + ' chunks');
  if (dist[0] === 0xef) fail('dist starts with 0xEF');
  if (!dist.includes(Buffer.from('Your smart account')) || !dist.includes(Buffer.from('blacksmith-v1-wallet'))) {
    fail('dist missing landing title or inlined SKILL.md');
  }
  if (dist.includes(Buffer.from('src="./app.mjs"'))) fail('dist still loads app.mjs; rebuild after build.mjs $& fix');
  if (!dist.includes(Buffer.from('<script type="module">')) || dist.includes(Buffer.from('<script type="module" src='))) {
    fail('dist missing inlined module');
  }

  const contracts = join(uiRoot, 'contracts');
  const runPath = join(contracts, 'broadcast-fork/Deploy.s.sol/1/run-latest.json');
  const call = (to, data) => jrpc(RPC, 'eth_call', [{ to, data, gas: '0x2faf080' }, 'latest'], 30000);
  const htmlSel = '0x33c34ac3';

  function loadBroadcast() {
    try {
      const run = JSON.parse(readFileSync(runPath, 'utf8'));
      const creates = run.transactions || [];
      const hostTx = [...creates].reverse().find((t) => t.contractName === 'VersionHost');
      const chunks = creates
        .filter((t) => t.transactionType === 'CREATE' && t.contractName !== 'VersionHost')
        .map((t) => t.contractAddress);
      const receipts = run.receipts || [];
      return { host: hostTx?.contractAddress || '', chunks, receipts, creates };
    } catch {
      return { host: '', chunks: [], receipts: [], creates: [] };
    }
  }

  let { host, chunks: chunkAddrs } = loadBroadcast();
  let fromChain = null;
  if (REUSE && host) {
    try {
      const code = await jrpc(RPC, 'eth_getCode', [host, 'latest']);
      if (code && code !== '0x' && (code.length - 2) / 2 <= 8000) {
        fromChain = decodeAbiString(await call(host, htmlSel));
      }
    } catch {
      fromChain = null;
    }
  }

  if (!fromChain || !fromChain.equals(dist)) {
    console.log('broadcast VersionHost on local fork via eth_sendTransaction…');
    ({ host, chunks: chunkAddrs } = await deployHost(dist, n, contracts));
    if (!host) fail('VersionHost create returned no address');
    console.log('broadcast ok host', host);
    fromChain = decodeAbiString(await call(host, htmlSel));
  } else {
    console.log('reusing fork VersionHost', host);
  }
  if (chunkAddrs.length !== n) fail('logged ' + chunkAddrs.length + ' chunks, dist is ' + n);

  const hostCode = await jrpc(RPC, 'eth_getCode', [host, 'latest']);
  if (!hostCode || hostCode === '0x') fail('VersionHost has no code');
  if ((hostCode.length - 2) / 2 > 8000) fail('VersionHost runtime too large; parsed a chunk as host');
  if (!fromChain.equals(dist)) fail('html() bytes !== dist/index.html (' + fromChain.length + ' vs ' + dist.length + ')');
  const liveKeccak = keccakUtf8(fromChain);
  if (liveKeccak.toLowerCase() !== freezeKeccak.toLowerCase()) fail('html() keccak ' + liveKeccak + ' !== freeze ' + freezeKeccak);
  console.log('html() matches freeze', liveKeccak, fromChain.length, 'B');

  let concat = Buffer.alloc(0);
  for (const addr of chunkAddrs) {
    const raw = await jrpc(RPC, 'eth_getCode', [addr, 'latest']);
    concat = Buffer.concat([concat, Buffer.from(String(raw).slice(2), 'hex')]);
  }
  if (!concat.equals(dist)) fail('concat(chunk.code) !== dist');
  console.log('concat(chunk.code) matches', n, 'chunks');

  const reqData = sh('cast', ['calldata', 'request(string[],(string,string)[])', '[]', '[]'], { timeout: 15000 }).trim();
  const reqHex = await call(host, reqData);
  const reqH = String(reqHex).replace(/^0x/i, '');
  const status = Number(BigInt('0x' + reqH.slice(0, 64)));
  if (status !== 200) fail('request() status ' + status);
  const bodyOff = Number(BigInt('0x' + reqH.slice(64, 128)));
  const body = decodePackedString(reqH, bodyOff);
  if (!body.equals(dist)) fail('request() body !== dist');

  const mode = String(await call(host, '0xdd473fae'));
  if (!/^0x35323139/i.test(mode)) fail('resolveMode want 5219 got ' + mode);
  console.log('request() 200 + resolveMode 5219');

  const aaRaw = await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(ANVIL_EOA) }, 'latest']);
  const wantAa = ('0x' + String(aaRaw).slice(-40)).toLowerCase();
  const aaCode = await jrpc(RPC, 'eth_getCode', [wantAa, 'latest']);
  if (!aaCode || aaCode === '0x') fail('seeded Kernel missing; run onchain-ui/dev/run.mjs first');

  const parsed = pageHostFromLocation({ hostname: `${host.toLowerCase()}.1.w3link.io` });
  if (!parsed || parsed.addr !== host.toLowerCase() || parsed.chain !== 1) fail('pageHostFromLocation missed fork host');
  if (pageHostFromLocation({ hostname: '127.0.0.1' })) fail('localhost must not look like a host');

  const pg = await playgroundFork();
  const fromBlock = pg?.fromBlock || (await forkMinedFromBlock(RPC));
  const tokens = Array.isArray(pg?.tokens) ? pg.tokens : [];
  const fork = { rpc: RPC, eoa: ANVIL_EOA, tokens, fromBlock };
  const served = injectHosted(fromChain.toString('utf8'), fork);
  const { server, origin } = await serveHtml(served, { port: HOST_UI_PORT });
  if (!served.includes('Your smart account')) fail('hosted html missing landing title');
  if (!served.includes('blacksmith-v1-wallet')) fail('hosted html missing inlined SKILL.md');
  // The pinned freeze is minified, so attribute quotes may be stripped (id=tab-wallet).
  const hasTab = (id) => served.includes(`id="${id}"`) || new RegExp(`id=["']?${id}\\b`).test(served);
  if (!hasTab('tab-wallet') || !hasTab('tab-activity') || !hasTab('tab-skill')) {
    fail('hosted html missing Wallet / Activity / SKILL.md tabs');
  }
  console.log('serving hosted freeze at', origin);

  const profile = mkdtempSync(join(tmpdir(), 'v1w-host-'));
  let probed;
  try {
    probed = await chromeProbe(origin, profile);
  } finally {
    server.close();
  }

  const smoke = probed.aa || '';
  const hostErr = probed.err || '';
  const ethBal = probed.eth || '';
  const epBal = probed.ep || '';
  const nTok = Number(probed.tokens || '0');
  const on = probed.on === '1';
  const aa = (smoke.startsWith('0x') ? smoke : '').toLowerCase();
  if (aa !== wantAa) {
    fail(
      'hosted Connect did not resolve Kernel, want ' +
        wantAa +
        ' got ' +
        (smoke || 'none') +
        (hostErr ? ' note=' + hostErr : '')
    );
  }
  if (!on) fail('hosted page did not enter connected chrome');
  if (!ethBal || ethBal === '-' || ethBal === '0') fail('hosted ETH balance missing, got ' + (ethBal || 'none'));
  if (!epBal || epBal === '-') fail('hosted prepaid gas missing, got ' + (epBal || 'none'));
  if (tokens.length && nTok < 8) {
    fail('hosted token list thin, want ≥8 of ' + tokens.length + ' seeded, got ' + nTok);
  }

  console.log(
    'ok host',
    host,
    'chunks',
    n,
    'keccak',
    liveKeccak,
    'aa',
    wantAa,
    'eth',
    ethBal,
    'ep',
    epBal,
    'tokens',
    nTok
  );
}

main().catch((e) => fail(e.message || String(e)));
