#!/usr/bin/env node
/** Click Connect on the local wallet page and write the address the page shows. */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeArgs, chromeBin } from '../../../onchain-ui/dev/chrome.mjs';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node drive-connect.mjs <evidence-dir>');
  process.exit(2);
}
const origin = process.env.ONCHAIN_UI_ORIGIN || 'http://127.0.0.1:8765';
mkdirSync(outDir, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'v1w-verify-'));
const dbg = 22000 + (process.pid % 1000);
const chrome = spawn(chromeBin(), chromeArgs([`--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, origin]), {
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(join(outDir, 'chrome.pid'), String(chrome.pid));

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
    /* chrome still starting */
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
  if (await js(`document.readyState === 'complete' && !!document.getElementById('connectLand')`)) break;
  await new Promise((r) => setTimeout(r, 150));
}
await js(`document.getElementById('connectLand').click()`);
const until = Date.now() + 30000;
let snap = null;
while (Date.now() < until) {
  snap = await js(`(() => {
    const aa = document.getElementById('aa')?.title || '';
    const bal = document.getElementById('ethBal')?.textContent || '';
    return aa.length === 42 && bal !== '-' ? { aa, bal } : null;
  })()`);
  if (snap) break;
  await new Promise((r) => setTimeout(r, 200));
}
if (!snap) die('connect did not show an account');
writeFileSync(join(outDir, 'connect.json'), JSON.stringify({ origin, ...snap }, null, 2) + '\n');
console.log(JSON.stringify(snap));
ws.close();
chrome.kill();
