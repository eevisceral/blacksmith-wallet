#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from '../../../onchain-ui/dev/chrome.mjs';
import { ACCOUNT_FACTORY } from '../../../onchain-ui/kernel.mjs';

const out = process.argv[2];
if (!out) {
  console.error('usage: node drive-send.mjs <evidence-dir>');
  process.exit(2);
}
const origin = process.env.ONCHAIN_UI_ORIGIN || 'http://127.0.0.1:8765';
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json()).then((j) => j.result);
const EOA = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const PLAIN = '0x4444444444444444444444444444444444444444';
const dbg = 23000 + (process.pid % 1000);
const chrome = launchChrome('v1w-send-', [`--remote-debugging-port=${dbg}`, origin]);
const die = (m) => { console.error('FAIL', m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = '';
for (let t = Date.now(); Date.now() - t < 15000 && !wsUrl; await sleep(150)) {
  try { const p = (await fetch(`http://127.0.0.1:${dbg}/json/list`).then((r) => r.json())).find((p) => p.type === 'page' && String(p.url).startsWith(origin)); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {}
}
if (!wsUrl) die('no chrome');
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) pend.get(m.id)(m); });
const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => { const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (m.result?.exceptionDetails) die(JSON.stringify(m.result.exceptionDetails)); return m.result?.result?.value; };
await send('Runtime.enable', {});
for (let t = Date.now(); Date.now() - t < 20000; await sleep(150)) if (await js(`document.readyState==='complete'&&!!document.getElementById('connectLand')`)) break;
await js(`document.getElementById('connectLand').click()`);
for (let t = Date.now(); Date.now() - t < 30000; await sleep(200)) if (await js(`(document.getElementById('aa')?.title||'').length===42 && document.getElementById('ethBal').textContent!=='-'`)) break;

async function trySend(dest, amount) {
  await js(`(() => { const d = document.getElementById('dest'); d.value = ${JSON.stringify(dest)}; d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await js(`(() => { const b = document.getElementById('takeEth'); if (!b.checked) b.click(); const a = document.getElementById('amtEth'); a.value = ${JSON.stringify(amount)}; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(1500);
  const before = await js(`({ go: !document.getElementById('go').disabled, destErr: document.getElementById('destErr').hidden ? '' : document.getElementById('destErr').textContent })`);
  const nonce0 = await rpc('eth_getTransactionCount', [EOA, 'latest']);
  const netsLocked = await js(`(() => { const n = document.getElementById('note'); n.textContent = ''; n.className = ''; document.getElementById('go').click(); return document.getElementById('c1').disabled && document.getElementById('c8453').disabled; })()`);
  let note = '';
  for (let t = Date.now(); Date.now() - t < 45000; await sleep(250)) {
    note = await js(`(() => { const n = document.getElementById('note'); return n.className + '|' + n.textContent; })()`);
    if (/^(err|ok)\|/.test(note)) break;
  }
  const nonce1 = await rpc('eth_getTransactionCount', [EOA, 'latest']);
  return { dest, amount, before, netsLocked, note, eoaTxs: Number(nonce1) - Number(nonce0) };
}
const fail = await trySend(ACCOUNT_FACTORY, '0.001');
const plainBefore = BigInt(await rpc('eth_getBalance', [PLAIN, 'latest']));
const ok = await trySend(PLAIN, '0.001');
ok.received = String(BigInt(await rpc('eth_getBalance', [PLAIN, 'latest'])) - plainBefore);
await js(`(() => {
  const n = document.getElementById('note');
  window.__notes = [];
  new MutationObserver(() => window.__notes.push(n.className + '|' + n.textContent)).observe(n, { childList: true, characterData: true, subtree: true, attributes: true });
  const p = window.__v1ForkProvider;
  const orig = p.request;
  p.request = async (a) => {
    if (a.method !== 'personal_sign') return orig(a);
    const sig = await orig(a);
    p.request = orig;
    p.__switchAccount('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    return sig;
  };
})()`);
const movedBefore = BigInt(await rpc('eth_getBalance', [PLAIN, 'latest']));
const moved = await trySend(PLAIN, '0.001');
moved.received = String(BigInt(await rpc('eth_getBalance', [PLAIN, 'latest'])) - movedBefore);
moved.notes = [...new Set(await js('window.__notes'))];
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(out, 'send.png'), Buffer.from(shot.result.data, 'base64'));
const chainId = Number(await rpc('eth_chainId', []));
const pass =
  /^err\|This send would fail/.test(fail.note) && fail.eoaTxs === 0 && /^ok\|Sent\./.test(ok.note) && ok.eoaTxs === 1 && ok.received === '1000000000000000' && fail.netsLocked && ok.netsLocked &&
  /^err\|The network or account changed/.test(moved.note) && moved.eoaTxs === 0 && moved.received === '0';
const res = { ok: pass, chainId, rejected: fail, sent: ok, accountSwitchedMidSend: moved };
writeFileSync(join(out, 'send.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
ws.close();
await chrome.close();
if (!pass) process.exit(1);
