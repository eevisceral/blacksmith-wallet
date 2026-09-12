#!/usr/bin/env node
/** Chrome UI the fork can drive: file:// freeze, w3link hostname, Max, custom token, disconnect, Base switch. */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ACCOUNT_FACTORY,
  KERNEL_FACTORY,
  encodeFactoryCreate,
  encodeFactoryGetAccount,
  encodeGetAccountAddress,
  hasCode,
  pageHostFromLocation,
} from '../kernel.mjs';
import { ANVIL_EOA, USDC, jrpc, waitForRpc } from './seed.mjs';
import { serveHtml, serveUiRoot } from './serve.mjs';
import { chromeBin } from './chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '..');
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const BASE_RPC = process.env.BASE_RPC || 'http://127.0.0.1:8546';
const CHROME = chromeBin();
const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const FAKE_HOST = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fail(reason) {
  console.error('FAIL', reason);
  process.exit(1);
}

function serveUi(fork) {
  const wallet = readFileSync(join(here, 'injected-wallet.js'), 'utf8');
  const boot = `<script>window.__V1_FORK__=${JSON.stringify(fork)};try{localStorage.setItem('v1w-rpc-1',window.__V1_FORK__.rpc);if(window.__V1_FORK__.baseRpc)localStorage.setItem('v1w-rpc-8453',window.__V1_FORK__.baseRpc)}catch{}</script><script>${wallet}</script>`;
  return serveUiRoot({
    uiRoot,
    patchIndexHtml: (html) =>
      html.replace(
        '<script type="module" src="./app.mjs"></script>',
        `${boot}<script type="module" src="./app.mjs"></script>`
      ),
  });
}

async function withChrome(url, extraArgs, fn) {
  const profile = mkdtempSync(join(tmpdir(), 'v1w-ui-'));
  const dbg = 20000 + (Date.now() % 20000) + Math.floor(Math.random() * 50);
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-proxy-server',
      '--use-mock-keychain',
      '--password-store=basic',
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstModeV2',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${dbg}`,
      `--user-data-dir=${profile}`,
      ...extraArgs,
      url,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let ws;
  const pending = new Map();
  const waiters = [];
  try {
    let wsUrl = '';
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      try {
        const pages = await fetch('http://127.0.0.1:' + dbg + '/json/list', { signal: AbortSignal.timeout(500) }).then((r) => r.json());
        const want = url.split('#')[0];
        const page = (pages || []).find(
          (p) => p.type === 'page' && p.webSocketDebuggerUrl && String(p.url || '').startsWith(want)
        );
        if (page) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {
        /* waiting */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!wsUrl) fail('chrome DevTools not listening');
    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('cdp websocket failed')));
    });
    let n = 0;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'cdp'));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        for (const w of [...waiters]) w(msg);
      }
    });
    const send = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++n;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const waitEvent = (method, ms = 8000) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no event ' + method)), ms);
        const onmsg = (msg) => {
          if (msg.method !== method) return;
          clearTimeout(t);
          const i = waiters.indexOf(onmsg);
          if (i >= 0) waiters.splice(i, 1);
          resolve(msg);
        };
        waiters.push(onmsg);
      });
    const js = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || expression);
      return r?.result?.value;
    };
    const waitJs = async (expression, ms = 15000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const v = await js(expression);
        if (v) return v;
        await new Promise((r) => setTimeout(r, 200));
      }
      fail('waitJs timeout: ' + expression);
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await fn({ js, waitJs, send, waitEvent });
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    child.kill('SIGKILL');
  }
}

async function main() {
  try {
    await waitForRpc(RPC, 8);
  } catch {
    fail('start node onchain-ui/dev/run.mjs first');
  }
  if (Number(await jrpc(RPC, 'eth_chainId', [])) !== 1) fail('ETH fork chainId want 1');

  const distPath = join(uiRoot, 'dist/index.html');
  const dist = readFileSync(distPath, 'utf8');
  if (!dist.includes('Your smart account') || dist.includes('src="./app.mjs"')) fail('dist freeze is not inlined');

  const w3 = pageHostFromLocation({ protocol: 'web3:', host: FAKE_HOST, pathname: '/' });
  if (!w3 || w3.addr !== FAKE_HOST || w3.chain !== 1) fail('web3:// parse ' + JSON.stringify(w3));
  for (const url of [`https://${FAKE_HOST}.1.w3link.io/`, `https://${FAKE_HOST}.w3eth.io/`]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: 'follow' });
      console.log('ok public gateway', url, r.status);
    } catch (e) {
      console.log('skip public gateway', url, (e && e.message) || e);
    }
  }

  await withChrome(pathToFileURL(distPath).href, ['--allow-file-access-from-files'], async ({ js, waitJs }) => {
    await waitJs(`document.getElementById('connectLand') && document.title`);
    const snap = await js(`({
      title: document.title,
      connect: !!document.getElementById('connectLand'),
      skill: (document.getElementById('skillMd')?.textContent || '').includes('blacksmith-v1-wallet'),
      pending: document.getElementById('hostPending') && !document.getElementById('hostPending').hidden,
      liveHidden: !!document.getElementById('hostLive')?.hidden,
      save: !!document.getElementById('hostSave'),
      castHidden: !!document.getElementById('hostCastBox')?.hidden,
    })`);
    if (snap.title !== 'Your smart account') fail('file:// title ' + snap.title);
    if (!snap.connect || !snap.skill) fail('file:// missing Connect or inlined SKILL.md');
    if (!snap.pending || !snap.liveHidden) fail('file:// host well should stay pending');
    if (!snap.save || !snap.castHidden) fail('file:// Save missing or fetch command shown');
    await js(`document.getElementById('hostSave').click()`);
    await waitJs(`(document.getElementById('note')?.textContent || '').includes('Saved v1.html')`);
  });
  console.log('ok file:// freeze');

  const gw = await serveHtml(dist);
  const gwHost = `${FAKE_HOST}.1.w3link.io`;
  try {
    await withChrome(`http://${gwHost}:${gw.port}/`, [`--host-resolver-rules=MAP ${gwHost} 127.0.0.1`], async ({ js, waitJs }) => {
      await waitJs(`document.getElementById('hostLive') && !document.getElementById('hostLive').hidden`);
      const snap = await js(`({
        addr: (document.getElementById('hostAddr')?.textContent || '').toLowerCase(),
        web3: document.getElementById('hostWeb3')?.textContent || '',
        gw: document.getElementById('hostGw')?.textContent || '',
        gwBase: document.getElementById('hostGwBase')?.textContent || '',
        cast: document.getElementById('hostCast')?.textContent || '',
        castShown: document.getElementById('hostCastBox') && !document.getElementById('hostCastBox').hidden,
        pendingHidden: !!document.getElementById('hostPending')?.hidden,
      })`);
      if (snap.addr !== FAKE_HOST) fail('w3link hostAddr ' + snap.addr);
      if (snap.web3 !== `web3://${FAKE_HOST}`) fail('w3link web3 ' + snap.web3);
      if (!snap.gw.includes(`${FAKE_HOST}.1.w3link.io`)) fail('w3link gateway link ' + snap.gw);
      if (!snap.gwBase.includes(`${FAKE_HOST}.8453.w3link.io`)) fail('w3link Base link ' + snap.gwBase);
      if (!snap.castShown || !snap.cast.includes(FAKE_HOST) || snap.cast.includes('HOST')) {
        fail('w3link fetch command ' + snap.cast);
      }
      if (!snap.pendingHidden) fail('w3link still showing pending copy');
    });
  } finally {
    gw.server.close();
  }
  console.log('ok w3link hostname well');

  const aaRaw = await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(ANVIL_EOA) }, 'latest']);
  const wantAa = ('0x' + String(aaRaw).slice(-40)).toLowerCase();
  let baseOk = false;
  try {
    baseOk = Number(await jrpc(BASE_RPC, 'eth_chainId', [], 2000)) === 8453;
  } catch {
    baseOk = false;
  }
  const ui = await serveUi({
    rpc: RPC,
    eoa: ANVIL_EOA,
    tokens: [],
    fromBlock: 9e15, // skip log scans; ETH vs Base heads are not the same number
    baseRpc: baseOk ? BASE_RPC : undefined,
    rpcEth: RPC,
  });
  try {
    await withChrome(`http://127.0.0.1:${ui.port}/`, [], async ({ js, waitJs, send, waitEvent }) => {
      // Wait for the deferred app.mjs module to load and wire up connectLand before clicking.
      await waitJs(`document.readyState === 'complete' && !!document.getElementById('connectLand')`);
      await js(`document.getElementById('connectLand')?.click()`);
      await waitJs(`(document.getElementById('aa')?.title || '').length === 42 && (document.getElementById('ethBal')?.textContent || '') !== '-'`, 30000);
      const aa = await js(`(document.getElementById('aa')?.title || '').toLowerCase()`);
      if (aa !== wantAa) fail('Connect aa ' + aa);

      await js(`document.querySelector('[data-max="eth"]')?.click()`);
      const max = await waitJs(`(() => {
        const v = (document.getElementById('amtEth')?.value || '').trim();
        const cap = document.getElementById('amtEth')?.dataset.cap;
        const on = document.getElementById('takeEth')?.checked;
        return v && cap && cap !== '0' && on ? { v, cap } : null;
      })()`);
      const ethWei = await js(`document.getElementById('ethBal')?.dataset.wei || '0'`);
      if (BigInt(max.cap) >= BigInt(ethWei)) fail('Max must leave prefund (cap ' + max.cap + ' bal ' + ethWei + ')');

      await js(`document.querySelector('.tok-add-open')?.click()`);
      await js(`(() => {
        const i = document.getElementById('tokenIn');
        i.value = '${UNI}';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('addTok').click();
      })()`);
      const tokErr = await waitJs(`(() => {
        const err = document.getElementById('tokenErr')?.textContent || '';
        if (err.includes('holds none')) return 'none';
        if ((document.getElementById('tokens')?.innerText || '').includes('UNI')) return 'listed';
        return '';
      })()`);
      if (tokErr !== 'none' && tokErr !== 'listed') fail('custom token paste did nothing');

      await js(`(() => {
        const i = document.getElementById('tokenIn');
        i.value = '${USDC}';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('addTok').click();
      })()`);
      await waitJs(`(document.getElementById('tokens')?.innerText || '').toUpperCase().includes('USDC')`);

      const dlg1 = waitEvent('Page.javascriptDialogOpening');
      const click1 = send('Runtime.evaluate', { expression: `document.getElementById('connect').click()`, returnByValue: true });
      const d1 = await dlg1;
      if (!/Disconnect/i.test(d1.params?.message || '')) fail('disconnect dialog copy ' + (d1.params?.message || ''));
      await send('Page.handleJavaScriptDialog', { accept: false });
      await click1;
      if (!(await js(`document.body.classList.contains('on')`))) fail('cancel disconnect dropped the session');

      const dlg2 = waitEvent('Page.javascriptDialogOpening');
      const click2 = send('Runtime.evaluate', { expression: `document.getElementById('connect').click()`, returnByValue: true });
      await dlg2;
      await send('Page.handleJavaScriptDialog', { accept: true });
      await click2;
      await waitJs(`!document.body.classList.contains('on')`);

      if (baseOk) {
        await js(`document.getElementById('connectLand')?.click() || document.getElementById('connect')?.click()`);
        await waitJs(`document.body.classList.contains('on')`);
        if (await js(`document.getElementById('c8453')?.disabled`)) fail('Base should be enabled when baseRpc is set');
        await js(`document.getElementById('c8453').click()`);
        await waitJs(`(() => {
          if (document.getElementById('c8453')?.getAttribute('aria-pressed') !== 'true') return null;
          if (/Switching/.test(document.getElementById('note')?.textContent || '')) return null;
          return (document.getElementById('aa')?.title || '').length === 42 ? true : null;
        })()`);
        const chain = await js(`({
          base: document.getElementById('c8453')?.getAttribute('aria-pressed'),
          eth: document.getElementById('c1')?.getAttribute('aria-pressed'),
          note: (document.getElementById('aaNote')?.textContent || '').slice(0, 160),
        })`);
        if (chain.base !== 'true' || chain.eth === 'true') fail('Base switch chrome ' + JSON.stringify(chain));
        console.log('ok base switch', chain.note || '(deployed on Base)');
      } else {
        console.log('skip base switch (no :8546 chain 8453)');
      }
    });
  } finally {
    ui.server.close();
  }
  console.log('ok max + token paste + disconnect');

  const SWITCH_EOA = '0x976EA74026E726554dB657fA54763abd0C3a0aa9';
  const addrOf = (raw) => '0x' + String(raw).slice(-40);
  const waitReceipt = async (hash) => {
    for (let i = 0; i < 40; i++) {
      const rec = await jrpc(RPC, 'eth_getTransactionReceipt', [hash]);
      if (rec) {
        if (BigInt(rec.status) === 0n) fail('tx reverted ' + hash);
        return rec;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    fail('no receipt ' + hash);
  };
  await jrpc(RPC, 'anvil_setCode', [SWITCH_EOA, '0x']);
  await jrpc(RPC, 'anvil_setBalance', [SWITCH_EOA, '0x' + (10n ** 18n).toString(16)]);
  if (!hasCode(await jrpc(RPC, 'eth_getCode', [ACCOUNT_FACTORY, 'latest']))) fail('AccountFactory missing for older-account UI');
  const switchOurs = addrOf(
    await jrpc(RPC, 'eth_call', [{ to: ACCOUNT_FACTORY, data: encodeFactoryGetAccount(SWITCH_EOA) }, 'latest'])
  );
  const switchLegacy = addrOf(
    await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(SWITCH_EOA) }, 'latest'])
  );
  if (!hasCode(await jrpc(RPC, 'eth_getCode', [switchOurs, 'latest']))) {
    const h = await jrpc(RPC, 'eth_sendTransaction', [
      { from: SWITCH_EOA, to: ACCOUNT_FACTORY, data: encodeFactoryCreate(SWITCH_EOA), value: '0x0', gas: '0x200000' },
    ]);
    await waitReceipt(h);
  }
  const legacyWasEmpty = !hasCode(await jrpc(RPC, 'eth_getCode', [switchLegacy, 'latest']));
  await jrpc(RPC, 'anvil_setBalance', [switchOurs, '0x' + (2n * 10n ** 18n).toString(16)]);
  if (legacyWasEmpty) await jrpc(RPC, 'anvil_setBalance', [switchLegacy, '0x' + (10n ** 17n).toString(16)]);
  const oursLc = switchOurs.toLowerCase();
  const legacyLc = switchLegacy.toLowerCase();
  const uiSwitch = await serveUi({ rpc: RPC, eoa: SWITCH_EOA, tokens: [], fromBlock: 9e15 });
  try {
    await withChrome(`http://127.0.0.1:${uiSwitch.port}/`, [], async ({ js, waitJs }) => {
      await waitJs(`document.readyState === 'complete' && !!document.getElementById('connectLand')`);
      await js(`document.getElementById('connectLand')?.click()`);
      await waitJs(
        `(() => {
          const aa = (document.getElementById('aa')?.title || '').toLowerCase();
          if (aa !== '${oursLc}') return null;
          const create = document.getElementById('create');
          if (create && !create.hidden) return null;
          const alt = (document.getElementById('aaAlt')?.title || '').toLowerCase();
          if (alt !== '${legacyLc}') return null;
          const act = document.getElementById('aaAct');
          if (${legacyWasEmpty ? 'true' : 'false'}) {
            if (!act || act.hidden || act.disabled) return null;
            return /Create older account/.test(act.textContent || '') ? true : null;
          }
          return !act || act.hidden ? true : null;
        })()`,
        30000
      );
      if (legacyWasEmpty) {
        await js(`document.getElementById('aaAct').click()`);
        await waitJs(
          `(() => {
            const aa = (document.getElementById('aa')?.title || '').toLowerCase();
            if (aa !== '${oursLc}') return null;
            const act = document.getElementById('aaAct');
            if (act && !act.hidden) return null;
            const create = document.getElementById('create');
            if (create && !create.hidden) return null;
            const alt = (document.getElementById('aaAlt')?.title || '').toLowerCase();
            return alt === '${legacyLc}' ? true : null;
          })()`,
          30000
        );
      }
    });
  } finally {
    uiSwitch.server.close();
  }
  console.log('ok older create stays on richer account');
}

main().catch((e) => fail(e.message || String(e)));
