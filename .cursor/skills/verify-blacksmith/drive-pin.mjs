#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeArgs, chromeBin } from '../../../onchain-ui/dev/chrome.mjs';
import { loadRepoEnv } from '../../../onchain-ui/dev/env.mjs';
import { checkLive, checkRecords } from '../../../onchain-ui/dev/pin-check.mjs';

const HOST = '0x7cdc1a1b2f4c15fa038fedd9d68f7d9a6ab93586';
const origin = 'https://0x7cdc1A1b2F4C15fa038fEdd9D68f7D9a6ab93586.1.w3link.io';
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node drive-pin.mjs <evidence-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
loadRepoEnv();
const pin = checkRecords();
const live = await checkLive(pin);
for (const r of live) {
  if (!r.factoryOn || !r.hostOn) {
    console.error('chain ' + r.id + ' factoryOn=' + r.factoryOn + ' hostOn=' + r.hostOn);
    process.exit(1);
  }
}

const profile = mkdtempSync(join(tmpdir(), 'v1w-pin-'));
const dbg = 24000 + (process.pid % 1000);
const chrome = spawn(chromeBin(), chromeArgs([`--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, origin + '/']), {
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(join(outDir, 'chrome-pin.pid'), String(chrome.pid));

function die(msg) {
  console.error(msg);
  chrome.kill();
  process.exit(1);
}

const t0 = Date.now();
let wsUrl = '';
while (Date.now() - t0 < 25000) {
  try {
    const list = await fetch(`http://127.0.0.1:${dbg}/json/list`, { signal: AbortSignal.timeout(500) }).then((r) => r.json());
    const page = (list || []).find(
      (p) => p.type === 'page' && p.webSocketDebuggerUrl && String(p.url || '').toLowerCase().includes('w3link.io'),
    );
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
while (Date.now() - ready < 25000) {
  if (await js(`document.readyState === 'complete' && !!document.getElementById('connectLand')`)) break;
  await new Promise((r) => setTimeout(r, 150));
}
const land = await js(`({
  title: document.querySelector('h1')?.textContent || '',
  connect: !!document.getElementById('connectLand'),
  on: document.body.classList.contains('on'),
  host: (document.getElementById('hostAddr')?.textContent || '').toLowerCase(),
})`);
await js(`document.getElementById('skillOpen').click()`);
const skill = await js(`({
  text: document.getElementById('skillView')?.innerText || '',
  copyOn: !document.getElementById('copySkill')?.disabled,
})`);
const ok =
  land.title.includes('Your smart account') &&
  land.connect &&
  land.on === false &&
  land.host === HOST &&
  skill.text.includes('Blacksmith V1 wallet') &&
  skill.text.includes('EntryPoint') &&
  skill.text.includes('0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf') &&
  skill.copyOn;
if (!ok) die(JSON.stringify({ land, skillHead: skill.text.slice(0, 200), copyOn: skill.copyOn }));
const out = {
  live: live.map((r) => ({ id: r.id, factoryOn: r.factoryOn, hostOn: r.hostOn })),
  gateway: origin + '/',
  land,
  skillOk: true,
};
writeFileSync(join(outDir, 'pin.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
ws.close();
chrome.kill();
