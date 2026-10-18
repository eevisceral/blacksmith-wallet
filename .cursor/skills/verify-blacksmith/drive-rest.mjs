#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeArgs, chromeBin } from '../../../onchain-ui/dev/chrome.mjs';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node drive-rest.mjs <evidence-dir>');
  process.exit(2);
}
const origin = process.env.ONCHAIN_UI_ORIGIN || 'http://127.0.0.1:8765';
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'v1w-verify-'));
const dbg = 23000 + (process.pid % 1000);
const chrome = spawn(chromeBin(), chromeArgs([`--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, origin]), {
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(join(outDir, 'chrome-rest.pid'), String(chrome.pid));

function die(msg) {
  console.error(msg);
  chrome.kill();
  process.exit(1);
}

const t0 = Date.now();
let wsUrl = '';
while (Date.now() - t0 < 15000) {
  try {
    const pages = await fetch(`http://127.0.0.1:${dbg}/json/list`, { signal: AbortSignal.timeout(500) }).then((r) => r.json());
    const page = (pages || []).find((p) => p.type === 'page' && p.webSocketDebuggerUrl && String(p.url || '').startsWith(origin));
    if (page) {
      wsUrl = page.webSocketDebuggerUrl;
      break;
    }
  } catch {
  }
  await new Promise((r) => setTimeout(r, 150));
}
if (!wsUrl) die('chrome did not open ' + origin);

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
});
function send(method, params) {
  const msgId = ++id;
  return new Promise((resolve) => {
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
async function js(expression) {
  const msg = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (msg.result?.exceptionDetails) die(JSON.stringify(msg.result.exceptionDetails));
  return msg.result?.result?.value;
}
await send('Runtime.enable', {});
const ready = Date.now();
while (Date.now() - ready < 20000) {
  if (await js(`document.readyState === 'complete' && !!document.getElementById('skillOpen')`)) break;
  await new Promise((r) => setTimeout(r, 150));
}

const snap = await js(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const factory = '0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf';
  document.getElementById('skillOpen').click();
  await sleep(300);
  const landing = document.getElementById('skillView')?.innerText || '';
  const landingOk = landing.includes('Blacksmith V1 wallet') && landing.includes('EntryPoint') && landing.includes(factory) && landing.includes('index 0, the only index this page uses');
  const copyOnLanding = document.getElementById('copySkill')?.disabled === false;
  document.getElementById('skillBack')?.click();
  document.getElementById('connectLand').click();
  let connected = null;
  for (let i = 0; i < 80; i++) {
    const aa = document.getElementById('aa')?.title || '';
    const bal = document.getElementById('ethBal')?.textContent || '';
    if (aa.length === 42 && bal !== '-') {
      connected = { aa, bal, dest: document.getElementById('dest')?.value || '', header: document.getElementById('connect')?.getAttribute('aria-label') || '' };
      break;
    }
    await sleep(200);
  }
  if (!connected) return { ok: false, step: 'connect' };
  document.querySelector('[data-max="eth"]').click();
  let max = null;
  for (let i = 0; i < 40; i++) {
    const a = document.getElementById('amtEth');
    const cap = a?.dataset.cap;
    if (a?.value?.trim() && cap && cap !== '0' && document.getElementById('takeEth')?.checked) {
      max = { cap, wei: document.getElementById('ethBal').dataset.wei, capBelow: BigInt(cap) < BigInt(document.getElementById('ethBal').dataset.wei) };
      break;
    }
    await sleep(200);
  }
  if (!max?.capBelow) return { ok: false, step: 'max', max };
  const dest = document.getElementById('dest');
  dest.value = '';
  dest.dispatchEvent(new Event('input', { bubbles: true }));
  const cleared = document.getElementById('go').disabled === true;
  document.getElementById('destMe').click();
  document.getElementById('tab-activity').click();
  await sleep(300);
  const empty = document.getElementById('histEmpty');
  const activity = {
    hidden: document.getElementById('panel-activity').hidden,
    rows: document.querySelectorAll('#hist li').length,
    emptyText: empty?.textContent || '',
    localShown: document.getElementById('histFork')?.hidden === false,
  };
  document.getElementById('tab-skill').click();
  const connectedSkill = document.getElementById('skillView')?.innerText || '';
  const skillOk = connectedSkill.includes('Blacksmith V1 wallet') && connectedSkill.includes(factory) && connectedSkill.includes('(connected account)') && (connectedSkill.includes('(derived from connected)') || connectedSkill.includes('not deployed on this chain'));
  const emptyOk = (activity.emptyText || '').includes('No activity yet. Token transfers, sends from this Kernel, and ETH received with no calldata show up here.');
  const pendHidden = document.getElementById('pendClear')?.hidden === true;
  const ok = landingOk && copyOnLanding && cleared && pendHidden && emptyOk && !activity.hidden && activity.rows > 0 && activity.localShown && skillOk;
  return { ok, landingOk, copyOnLanding, connected, max, cleared, pendHidden, emptyOk, activity, skillOk };
})()`);

if (!snap?.ok) die('rest journeys failed ' + JSON.stringify(snap));
writeFileSync(join(outDir, 'rest.json'), JSON.stringify({ origin, ...snap }, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, rows: snap.activity.rows, aa: snap.connected.aa }));
ws.close();
chrome.kill();
