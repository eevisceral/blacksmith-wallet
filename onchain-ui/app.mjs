import {
  CHAINS,
  ENTRY_POINT,
  KERNEL_FACTORY,
  ACCOUNT_FACTORY,
  PAGE_HOST,
  pageHostFromLocation,
  explorerAddress,
  explorerToken,
  explorerTx,
  explorerOrigin,
  encodeBalanceOf,
  encodeGetAccountAddress,
  encodeFactoryGetAccount,
  isAddress,
  isBlockedDest,
  hasCode,
  accountFromWord,
  pickAccount,
  kernelExecImpl,
  kernelBatchImpl,
} from './kernel.mjs';
import {
  $,
  eq,
  hex,
  word,
  fmtAmt,
  fmtEth,
  short,
  clip,
  esc,
  renderMd,
  fillSkill,
  EMPTY_WALLET,
  LS_RPC,
  LS_TOK,
  LS_THEME,
} from './util.mjs';
import {
  jrpc,
  call,
  decodeStr,
  getRpcUrl,
  setRpcUrl,
  chooseRpc,
  accountBirth,
  scanAccountLogs,
  scanRangeLogs,
  logsFrom,
  kernelImpl,
  rpcHasDeepLogs,
  pruneFloor,
  PRUNE_HINT,
  timeoutLogsMsg,
  walkTransfersIn,
  TOK_WALK_PUBLIC,
  TOK_WALK_CUSTOM,
  LOGS_LOOKBACK,
} from './rpc.mjs';
import { destError, DEST_7702, is7702 } from './dest.mjs';
import { HIST_V, initHist, histCur, renderHist, pushHist, discoverHist, discoverAlchHist, backfillHist } from './history.mjs';
import { LS_ALCH, LS_DUST, alchKey, alchRpc, alchPortfolio, fmtUsd, usdHold, dustTok } from './alchemy.mjs';
import {
  initSend,
  selectedPicks,
  send,
  sendFail,
  fillMax,
  prefillMaxes,
  resetFeeMemo,
  getPendingTx,
  forgetPendingTx,
  loadPendingTx,
  checkPendingReceipt,
  createKernel,
} from './send.mjs';

const CREATE_NOTE =
  'No smart account on this network yet. Create it once — your wallet pays gas. Same address if someone already paid you.';
const CREATE_RESCUE =
  'This address already holds a balance. Create the account here so those funds can be used.';
const CREATE_FACTORY_MISSING = 'This page’s factory is not on this chain yet.';
const CREATE_STRANDED =
  'An older address already holds a balance. Create that account so those funds can be used.';
const ALSO_OLDER = 'This wallet also has an older account.';
const ALSO_OURS = 'This page’s account is still here.';
const SEND_ONE = 'This account sends one asset at a time.';
const CLIP_HINT = 'Showing recent history. Custom RPC can go further back.';
const TOK_SCANNING = 'Scanning older transfers…';
const TOK_WALL = 'Public nodes can’t serve this account’s older blocks. Paste a token address, or set a Custom RPC to scan further back.';
const TOK_CATCHUP = 'Catching up on recent blocks. Tokens appear as the scan reaches them.';
const tokMoreHint = (f) =>
  `Scanned back to block ${f}. Older tokens may not show yet — scan further, paste a token address, or set a Custom RPC.`;

const EXT_ICO = '<svg class="i" aria-hidden="true"><use href="#i-ext"/></svg>';
function explorerOpenHtml(target, kind = 'token') {
  if (forkCfg()) return '';
  let href = '';
  let label = '';
  if (kind === 'tx' && /^0x[0-9a-fA-F]{64}$/.test(target || '')) {
    href = explorerTx(chainId, target);
    label = 'View transaction on explorer';
  } else if (isAddress(target)) {
    href = kind === 'token' ? explorerToken(chainId, target) : explorerAddress(chainId, target);
    label = kind === 'token' ? 'View token on explorer' : 'View address on explorer';
  }
  if (!href) return '';
  return `<a class="icon-btn tok-open quiet" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(label)}">${EXT_ICO}</a>`;
}
function addrLineHtml(addr, kind = 'address') {
  if (!isAddress(addr)) return '';
  return `<span class="tok-addr-line"><span class="mono" title="${esc(addr)}">${esc(clip(addr))}</span>${explorerOpenHtml(addr, kind)}</span>`;
}
function txHashHtml(hash) {
  const safe = /^0x[0-9a-fA-F]{64}$/.test(hash || '') ? hash : '';
  if (!safe) return '';
  const label = `${safe.slice(0, 10)}…${safe.slice(-6)}`;
  return `<span class="tok-addr-line"><span class="mono" title="${esc(safe)}">${esc(label)}</span>${explorerOpenHtml(safe, 'tx')}</span>`;
}
const setAddr = (id, a) => {
  const el = $(id);
  el.title = a || '';
  el.textContent = clip(a);
  paintAa();
};

function setExplorerLink(el, href, label) {
  const on = !!href;
  el.toggleAttribute('aria-disabled', !on);
  el.tabIndex = on ? 0 : -1;
  if (on) el.href = href;
  else el.removeAttribute('href');
  if (label) el.setAttribute('aria-label', label);
}

function paintAa() {
  const ok = isAddress(aa);
  const live = ok && !forkCfg();
  const href = live ? explorerAddress(chainId, aa) : '';
  $('copyAa').hidden = !ok;
  setExplorerLink(
    $('openAa'),
    href,
    live ? 'View account on explorer' : ok ? 'Explorer unavailable on local fork' : 'View account on explorer'
  );
  paintAlt();
}

function altAddr() {
  if (legacyStranded && isAddress(legacyRescueAddr)) return legacyRescueAddr;
  return deployed && isAddress(altAa) ? altAa : '';
}

function paintAlt() {
  const el = $('aaAlt');
  if (!el) return;
  const addr = altAddr();
  el.hidden = !addr;
  el.title = addr || '';
  el.textContent = addr ? clip(addr) : '';
}

function setHint(id, msg) {
  const el = $(id);
  el.textContent = msg || '';
  el.hidden = !msg;
}

function accountNote() {
  if (!deployed) {
    if (!aa) return { text: CREATE_FACTORY_MISSING, err: true };
    if (aaRescue) return { text: CREATE_RESCUE, err: eoaWei === 0n };
    return { text: CREATE_NOTE, err: eoaWei === 0n };
  }
  if (!implOk) return { text: 'Unexpected implementation. Don’t send.', err: true };
  const bits = [];
  if (legacyStranded) bits.push(CREATE_STRANDED);
  if (altAa && aaSource === 'ours') bits.push(ALSO_OLDER);
  if (altAa && aaSource === 'legacy') bits.push(ALSO_OURS);
  return { text: bits.join(' '), err: false };
}

function setGo() {
  const go = $('go');
  const create = $('create');
  const aaAct = $('aaAct');
  const noGas = eoaWei === 0n;
  const dest = $('dest').value.trim();
  const destOk = isAddress(dest) && !isBlockedDest(dest, aa);
  const { picks, ready } = selectedPicks();
  const tooMany = picks.length > maxPicks;
  const pending = getPendingTx();
  const lock = busy || noGas || !!pending;
  create.hidden = !!deployed;
  go.hidden = !deployed;
  const canCreate = !deployed && !!eoa && isAddress(aa) && (factoryOnChain || aaRescue);
  create.disabled = !canCreate || lock;
  const creating = busy && !deployed;
  create.setAttribute('aria-busy', creating ? 'true' : 'false');
  create.textContent = creating ? 'Creating…' : 'Create account';
  create.title =
    busy || !create.disabled
      ? ''
      : pending
        ? 'A transaction is still confirming.'
        : !eoa
          ? 'Connect wallet to create'
          : noGas
            ? EMPTY_WALLET
            : !factoryOnChain && !aaRescue
              ? CREATE_FACTORY_MISSING
              : '';
  const canRescue = !!legacyStranded && !!eoa && isAddress(legacyRescueAddr);
  if (aaAct) {
    aaAct.hidden = !legacyStranded;
    aaAct.disabled = !canRescue || lock;
    const rescuing = busy && !!legacyStranded;
    aaAct.setAttribute('aria-busy', rescuing ? 'true' : 'false');
    aaAct.textContent = rescuing ? 'Creating…' : 'Create older account';
    aaAct.title =
      busy || !aaAct.disabled
        ? ''
        : pending
          ? 'A transaction is still confirming.'
          : !eoa
            ? 'Connect wallet to create'
            : noGas
              ? EMPTY_WALLET
              : '';
  }
  paintAlt();
  go.disabled = !deployed || !implOk || lock || !ready || !destOk || tooMany;
  go.setAttribute('aria-busy', busy && deployed ? 'true' : 'false');
  const label =
    picks.length === 1 ? `Send ${fmtAmt(picks[0].amount, picks[0].decimals, picks[0].label)}` : picks.length > 1 ? `Send ${picks.length} assets` : 'Send';
  go.textContent = busy && deployed ? 'Sending…' : ready && destOk ? label : 'Send';
  let reason = 'Pick assets and enter amounts.';
  if (pending) reason = 'A send is still confirming. Check Activity.';
  else if (!eoa) reason = 'Connect wallet to send';
  else if (!deployed) reason = 'Create your account first';
  else if (!implOk) reason = 'Unexpected implementation. Don’t send.';
  else if (tooMany) reason = SEND_ONE;
  else if (noGas) reason = EMPTY_WALLET;
  else if (!destOk) reason = 'Enter a destination.';
  go.title = busy || !go.disabled ? '' : reason;
}

function setChainButtons() {
  const fork = !!(provider && provider.isAnvilFork);
  const dual = !!(provider && provider.baseRpc);
  $('c1').disabled = !eoa || (fork && !dual && chainId !== 1);
  $('c8453').disabled = !eoa || (fork && !dual && chainId !== 8453);
  $('c1').title = fork && !dual && chainId !== 1 ? 'This playground is Base only' : '';
  $('c8453').title = fork && !dual && chainId !== 8453 ? 'This playground is Ethereum only' : '';
}

function markChain(id) {
  $('c1').classList.toggle('on', id === 1);
  $('c8453').classList.toggle('on', id === 8453);
  $('c1').setAttribute('aria-pressed', String(id === 1));
  $('c8453').setAttribute('aria-pressed', String(id === 8453));
  paintAa();
  const live = !forkCfg();
  $('epAddr').textContent = clip(ENTRY_POINT);
  $('epAddr').title = ENTRY_POINT;
  setExplorerLink(
    $('epOpen'),
    live ? explorerAddress(chainId, ENTRY_POINT) : '',
    live ? 'View EntryPoint on explorer' : 'Explorer unavailable on local fork'
  );
  $('histFork').hidden = live;
}

let provider = null;
let unwatch = () => {};
let eoa = '';
let eoaWei = 0n;
let chainId = 1;
let aa = '';
let aaSource = '';
let aaRescue = false;
let legacyStranded = false;
let legacyRescueAddr = '';
let altAa = '';
let altSource = '';
let factoryOnChain = false;
let deployed = false;
let implOk = true;
let maxPicks = Infinity;
let tokens = [];
let ethUsd = 0;
let hideDust = true;
const tokMeta = new Map();
let busy = false;
let scanId = 0;
let lastKind = 'muted';

function setReceipt(amount, hash, dest) {
  const el = $('tx');
  $('dock').classList.add('sent');
  el.className = 'receipt ok';
  el.innerHTML = `<p class="amt">${esc(amount)}</p><p class="to">to ${esc(dest)}</p>${txHashHtml(hash)}`;
}

function clearReceipt() {
  $('dock').classList.remove('sent');
  $('tx').textContent = '';
  $('tx').className = 'receipt';
}

function paintDestHint() {
  const dest = $('dest').value.trim();
  const mine = !!(eoa && isAddress(dest) && eq(dest, eoa));
  $('destHint').hidden = !mine;
  $('destHint').title = '';
  $('destMe').hidden = !eoa || mine;
  if (!mine) return;
  jrpc(getRpcUrl(), 'eth_getCode', [dest, 'latest'])
    .then((code) => {
      if ($('dest').value.trim().toLowerCase() !== dest.toLowerCase()) return;
      if (is7702(code)) $('destHint').title = DEST_7702;
    })
    .catch(() => {});
}

function paintDestErr() {
  setHint('destErr', destError({ dest: $('dest').value.trim(), aa }));
}

function fillDestMe(clear) {
  if (!clear && !eoa) return;
  $('dest').value = clear ? '' : eoa;
  paintDestErr();
  paintDestHint();
  setGo();
}

let noteT = 0;
let noteHold = 0;

function noteHoldMs(kind, s) {
  if (!s || kind === 'wait' || s.endsWith('…')) return 0;
  if (kind === 'err') return 7000;
  if (kind === 'ok') return 2800;
  return 4500;
}

function armNote(ms) {
  clearTimeout(noteT);
  noteHold = ms;
  if (!ms) return;
  noteT = setTimeout(() => setStatus(''), ms);
}

function setStatus(s, cls) {
  const wait = !cls && !!(s && s.endsWith('…'));
  const kind = cls || (wait ? 'wait' : 'muted');
  lastKind = kind;
  const el = $('note');
  const next = s || '';
  const clsName = kind === 'err' ? 'err' : kind === 'wait' || wait ? 'wait' : kind === 'ok' ? 'ok' : 'muted';
  const hold = noteHoldMs(kind, next);
  if (el.textContent === next && el.className === clsName) {
    armNote(hold);
    return;
  }
  el.textContent = next;
  el.className = clsName;
  if (next && hold) el.tabIndex = 0;
  else el.removeAttribute('tabindex');
  armNote(hold);
}

let skillRaw = '';

function isSkill(t) {
  const s = (t || '').trimStart();
  return s.startsWith('---') && s.includes('name: blacksmith-v1-wallet');
}

function filledSkill() {
  return fillSkill(skillRaw, { eoa, aa, deployed });
}

function showSkill() {
  const t = filledSkill();
  $('skillView').innerHTML = t ? renderMd(t) : '';
  $('copySkill').disabled = !isSkill(skillRaw);
  $('skillHint').hidden = !!eoa;
}

async function loadSkill() {
  if (isSkill(skillRaw)) {
    showSkill();
    return;
  }
  const pre = $('skillMd').textContent || '';
  if (isSkill(pre)) {
    skillRaw = pre;
    showSkill();
    return;
  }
  try {
    const r = await fetch('SKILL.md', { cache: 'no-store' });
    const x = r.ok ? await r.text() : '';
    if (isSkill(x)) skillRaw = x;
  } catch {
    /* VersionHost html() has no sibling; ERC-5219 ignores path */
  }
  showSkill();
}

function copyText(t) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, t.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    ta.remove();
  }
  if (!ok) throw new Error('Copy failed.');
}

function flashCopied(btn) {
  if (!btn) return;
  btn._copyLabel = btn._copyLabel || btn.getAttribute('aria-label') || 'Copy';
  btn.dataset.copied = '1';
  btn.setAttribute('aria-label', 'Copied');
  clearTimeout(btn._copiedT);
  btn._copiedT = setTimeout(() => {
    delete btn.dataset.copied;
    btn.setAttribute('aria-label', btn._copyLabel);
  }, 1600);
}

async function copyOut(t, el, btn) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(t);
    else copyText(t);
    flashCopied(btn);
  } catch {
    try {
      copyText(t);
      flashCopied(btn);
    } catch {
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      setStatus('Copy blocked. The text is selected. Use your browser copy.', 'err');
    }
  }
}

async function copyAa() {
  if (!isAddress(aa)) return;
  await copyOut(aa, $('aa'), $('copyAa'));
}

async function copySkill() {
  if (!isSkill(skillRaw)) await loadSkill();
  const t = filledSkill();
  if (!isSkill(skillRaw)) throw new Error('Skill is still loading.');
  await copyOut(t, $('skillView'), $('copySkill'));
}

function announced() {
  const list = [];
  const on = (e) => list.push(e.detail);
  window.addEventListener('eip6963:announceProvider', on);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  window.removeEventListener('eip6963:announceProvider', on);
  return list;
}

function rpcPaste(id = chainId) {
  return ($('rpcIn').value || localStorage.getItem(LS_RPC + id) || '').trim();
}

function alchPaste() {
  return alchKey(($('alchIn') && $('alchIn').value) || localStorage.getItem(LS_ALCH) || '');
}

function alchOn(id = chainId) {
  if (forkCfg()) return '';
  return alchPaste() || alchKey(rpcPaste(id));
}

function rpcPin(id = chainId) {
  return rpcPaste(id) || alchRpc(alchPaste(), id);
}

async function pickRpc(id) {
  const custom = rpcPaste(id);
  const via = rpcPin(id);
  // A pasted RPC (or Alchemy key → exclusive Alchemy URL) is the pin. Falling through to public
  // would send a local-fork user onto live L1 without saying so.
  try {
    return await chooseRpc(id, via || undefined, CHAINS[id].rpcs);
  } catch (e) {
    throw new Error(
      e.message === 'wrong chain'
        ? custom
          ? 'That RPC is the wrong network. Paste one for this chain.'
          : via
            ? 'Alchemy is the wrong network for this chain.'
            : 'Public RPC is the wrong network. Paste a custom RPC.'
        : custom
          ? 'Couldn’t reach that RPC. Check the URL or paste another.'
          : via
            ? 'Couldn’t reach Alchemy. Check the key.'
            : 'Couldn’t reach this network. Paste a custom RPC or an Alchemy key.'
    );
  }
}

async function ensureRpc() {
  const via = rpcPin();
  if (via && via !== getRpcUrl()) {
    await pickRpc(chainId);
    return;
  }
  if (getRpcUrl()) {
    try {
      const cid = await jrpc(getRpcUrl(), 'eth_chainId', [], 8000);
      if (String(cid).toLowerCase() === hex(chainId).toLowerCase()) return;
    } catch {
      /* re-pick */
    }
  }
  await pickRpc(chainId);
}

async function wallet(method, params) {
  return provider.request({ method, params });
}

function watchWallet(p) {
  unwatch();
  unwatch = () => {};
  if (!p?.on) return;
  const onAcc = (accs) => {
    if (p !== provider) return;
    const next = accs && accs[0];
    if (!next) {
      disconnect();
      return;
    }
    if (!isAddress(next) || eq(next, eoa)) return;
    forgetPendingTx();
    eoa = next;
    aa = '';
    aaSource = '';
    aaRescue = false;
    legacyStranded = false;
    legacyRescueAddr = '';
    altAa = '';
    altSource = '';
    deployed = false;
    fillDestMe();
    paintConnect();
    showSkill();
    setGo();
    refreshAccount().catch((e) => setStatus(e.message, 'err'));
  };
  const onChain = (cid) => {
    if (p !== provider) return;
    const id = Number(cid);
    if (id === 1 || id === 8453) {
      switchChain(id).catch((e) => setStatus(e.message, 'err'));
      return;
    }
    setStatus('This wallet switched to a network this page does not use. Pick Ethereum or Base.', 'err');
  };
  p.on('accountsChanged', onAcc);
  p.on('chainChanged', onChain);
  unwatch = () => {
    p.removeListener?.('accountsChanged', onAcc);
    p.removeListener?.('chainChanged', onChain);
  };
}

function pageHost() {
  return pageHostFromLocation(location, PAGE_HOST);
}

function paintLink(el, href, text) {
  el.textContent = text == null ? href : text;
  el.href = href;
  if (/^https?:/i.test(href)) {
    el.target = '_blank';
    el.rel = 'noopener';
  }
}

function hostCastCmd(addr, chain) {
  return `cast call ${addr} "html()(string)" --rpc-url ${CHAINS[chain].rpcs[0]} > v1.html`;
}

function paintPageHost() {
  const found = pageHost();
  const pending = $('hostPending');
  const live = $('hostLive');
  const box = $('hostCastBox');
  const cast = $('hostCast');
  if (!found) {
    pending.hidden = false;
    live.hidden = true;
    box.hidden = true;
    cast.textContent = '';
    return;
  }
  pending.hidden = true;
  live.hidden = false;
  box.hidden = false;
  const chain = found.chain === 8453 ? 8453 : 1;
  const addr = found.addr;
  $('hostAddr').textContent = addr;
  paintLink($('hostWeb3'), chain === 8453 ? `web3://${addr}:8453` : `web3://${addr}`);
  paintLink($('hostGw'), `https://${addr}.1.w3link.io/`);
  paintLink($('hostGwBase'), `https://${addr}.8453.w3link.io/`);
  const s = $('hostScan');
  s.href = explorerAddress(chain, addr);
  s.target = '_blank';
  s.removeAttribute('aria-disabled');
  s.tabIndex = 0;
  cast.textContent = hostCastCmd(addr, chain);
}

function pageIsSource() {
  return !!document.querySelector('script[src$="app.mjs"]');
}

function isFreezeHtml(t) {
  return /<html[\s>]/i.test(t) && !/src=["'][^"']*app\.mjs["']/.test(t) && t.includes('Your smart account');
}

function pageSnapshot() {
  const root = document.documentElement.cloneNode(true);
  root.removeAttribute('data-theme');
  const body = root.querySelector('body');
  if (body) {
    body.classList.remove('on');
    body.dataset.tab = 'wallet';
  }
  const note = root.querySelector('#note');
  if (note) {
    note.textContent = '';
    note.removeAttribute('class');
  }
  const pending = root.querySelector('#hostPending');
  const live = root.querySelector('#hostLive');
  const box = root.querySelector('#hostCastBox');
  if (pending) pending.hidden = false;
  if (live) live.hidden = true;
  if (box) box.hidden = true;
  const tokens = root.querySelector('#tokens');
  if (tokens) tokens.textContent = '';
  const hm = root.querySelector('#histMore');
  if (hm) hm.hidden = true;
  const hf = root.querySelector('#histFloor');
  if (hf) hf.hidden = true;
  for (const b of root.querySelectorAll('[data-copied]')) b.removeAttribute('data-copied');
  return '<!DOCTYPE html>\n' + root.outerHTML;
}

async function readHtml(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return '';
  const t = await r.text();
  return isFreezeHtml(t) ? t : '';
}

async function freezeHtml() {
  if (!pageIsSource()) {
    try {
      const t = await readHtml(location.href);
      if (t) return t;
    } catch {
      /* file:// / Freedom */
    }
    const snap = pageSnapshot();
    if (isFreezeHtml(snap)) return snap;
    throw new Error('Couldn’t capture this page.');
  }
  try {
    const t = await readHtml(new URL('dist/index.html', location.href));
    if (t) return t;
  } catch {
    /* no freeze beside this preview */
  }
  throw new Error('Save needs the built page. Open dist/index.html and try again.');
}

async function savePage() {
  const html = await freezeHtml();
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'v1.html';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  setStatus('Saved v1.html. Open that file in a browser anytime.', 'ok');
}

async function copyHost() {
  const found = pageHost();
  if (!found) return;
  await copyOut(found.addr, $('hostAddr'), $('copyHost'));
}

async function copyCast() {
  const found = pageHost();
  if (!found) return;
  const chain = found.chain === 8453 ? 8453 : 1;
  await copyOut(hostCastCmd(found.addr, chain), $('hostCast'), $('copyCast'));
}

function placeConnect() {
  $('connect').classList.toggle('quiet', !!eoa);
}

function syncDock() {
  $('dock').hidden = document.body.dataset.tab !== 'wallet' || !eoa;
}

function paintConnect() {
  document.body.classList.toggle('on', !!eoa);
  syncDock();
  const b = $('connect');
  b.classList.toggle('pri', !eoa);
  b.classList.toggle('acct', !!eoa);
  if (eoa) {
    b.innerHTML = `<span class="mono">${esc(short(eoa))}</span><svg class="i" aria-hidden="true"><use href="#i-off"/></svg>`;
    b.title = `Disconnect ${eoa}`;
    b.setAttribute('aria-label', `Disconnect ${short(eoa)}`);
  } else {
    b.textContent = 'Connect wallet';
    b.title = '';
    b.setAttribute('aria-label', 'Connect wallet');
  }
  placeConnect();
}

function paintTab(name) {
  let tab = name === 'activity' || name === 'skill' ? name : 'wallet';
  if (!eoa && tab === 'activity') tab = 'wallet';
  document.body.dataset.tab = tab;
  for (const id of ['wallet', 'activity', 'skill']) {
    const b = $('tab-' + id);
    const on = id === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $('panel-wallet').hidden = tab !== 'wallet';
  $('panel-activity').hidden = tab !== 'activity';
  $('panel-skill').hidden = tab !== 'skill';
  syncDock();
  $('skillOpen').setAttribute('aria-expanded', String(tab === 'skill'));
  placeConnect();
  if (tab === 'skill') showSkill();
  if (tab === 'wallet' && eoa) setGo();
}

function disconnect() {
  unwatch();
  unwatch = () => {};
  forgetPendingTx();
  scanId += 1;
  eoa = '';
  aa = '';
  aaSource = '';
  aaRescue = false;
  legacyStranded = false;
  legacyRescueAddr = '';
  altAa = '';
  altSource = '';
  factoryOnChain = false;
  deployed = false;
  implOk = true;
  maxPicks = Infinity;
  provider = null;
  setRpcUrl('');
  tokens = [];
  busy = false;
  setAddr('aa', '');
  eoaWei = 0n;
  $('ethBal').textContent = '-';
  $('epBal').textContent = '-';
  $('aaNote').textContent = '';
  $('dest').value = '';
  $('amtEth').value = '';
  $('amtEp').value = '';
  $('hist').replaceChildren();
  $('histEmpty').hidden = false;
  $('tokEmpty').hidden = true;
  $('tokMore').hidden = true;
  $('takeEth').checked = false;
  $('takeEp').checked = false;
  clearReceipt();
  renderTokens();
  paintHistMore();
  paintConnect();
  showSkill();
  paintTab('wallet');
  paintDestHint();
  setChainButtons();
  setGo();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureForkWallet() {
  if (window.__v1ForkProvider) return;
  const host = location.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') return;
  const inject = () => loadScript('/dev/injected-wallet.js').catch(() => {});
  if (window.__V1_FORK__) {
    await inject();
    return;
  }
  try {
    const r = await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(800),
    });
    const j = await r.json();
    if (j.result) await inject();
  } catch {
    /* no local anvil */
  }
}

async function connect() {
  setStatus('Connecting…');
  await ensureForkWallet();
  const found = announced();
  provider = window.__v1ForkProvider || found[0]?.provider || window.ethereum;
  if (!provider) {
    setStatus('No wallet in this browser. Unlock or install one, then refresh.', 'err');
    return;
  }
  const acc = await wallet('eth_requestAccounts', []);
  const next = acc && acc[0];
  if (!isAddress(next)) {
    provider = null;
    setStatus('That wallet did not return an address. Try another wallet.', 'err');
    return;
  }
  eoa = next;
  watchWallet(provider);
  showSkill();
  if (!$('dest').value.trim()) fillDestMe();
  else paintDestHint();
  paintConnect();
  setChainButtons();
  setGo();
  const wcid = Number(await wallet('eth_chainId', []));
  if (wcid === 1 || wcid === 8453) chainId = wcid;
  await switchChain(chainId);
}

let switchQ = Promise.resolve();
async function rpcMatches(id) {
  const u = getRpcUrl();
  if (!u) return false;
  try {
    return Number(await jrpc(u, 'eth_chainId', [], 8000)) === id;
  } catch {
    return false;
  }
}

async function switchChain(id) {
  const run = () => switchChainOnce(id);
  switchQ = switchQ.then(run, run);
  await switchQ;
}

async function switchChainOnce(id) {
  const wcid = Number(await wallet('eth_chainId', []));
  if (id === chainId && wcid === id && (await rpcMatches(id))) {
    setChainButtons();
    return;
  }
  setStatus('Switching networks…');
  const cid = hex(id);
  try {
    await wallet('wallet_switchEthereumChain', [{ chainId: cid }]);
  } catch (e) {
    if (e.code === 4902 || /4902/.test(e.message || '')) {
      try {
        await wallet('wallet_addEthereumChain', [
          {
            chainId: cid,
            chainName: CHAINS[id].name,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [CHAINS[id].rpcs[0]],
            blockExplorerUrls: [explorerOrigin(id)],
          },
        ]);
        await wallet('wallet_switchEthereumChain', [{ chainId: cid }]);
      } catch (e2) {
        setStatus(e2.message || 'Could not switch networks', 'err');
        return;
      }
    } else {
      setStatus(e.message || 'Could not switch networks', 'err');
      return;
    }
  }
  if (Number(await wallet('eth_chainId', [])) !== id) {
    setStatus('Could not switch networks', 'err');
    return;
  }
  $('rpcIn').value = localStorage.getItem(LS_RPC + id) || '';
  paintPin('rpc', false);
  paintPin('alch', false);
  try {
    await pickRpc(id);
  } catch (e) {
    setStatus(e.message, 'err');
    return;
  }
  forgetPendingTx();
  chainId = id;
  markChain(id);
  setChainButtons();
  aa = '';
  aaSource = '';
  aaRescue = false;
  legacyStranded = false;
  legacyRescueAddr = '';
  altAa = '';
  altSource = '';
  factoryOnChain = false;
  deployed = false;
  setAddr('aa', '');
  eoaWei = 0n;
  $('ethBal').textContent = '-';
  $('epBal').textContent = '-';
  delete $('ethBal').dataset.wei;
  delete $('epBal').dataset.wei;
  $('aaNote').textContent = '';
  showSkill();
  scanId += 1;
  tokens = [];
  $('amtEth').value = '';
  $('amtEp').value = '';
  clearReceipt();
  renderTokens();
  await refreshAccount();
}

function forkCfg() {
  return window.__V1_FORK__ || null;
}

function lsCur(prefix, blank, set) {
  const k = prefix + (forkCfg() ? 'f-' : '') + chainId + '-' + aa.toLowerCase();
  if (set) {
    localStorage.setItem(k, JSON.stringify(set));
    return set;
  }
  try {
    return JSON.parse(localStorage.getItem(k) || 'null') || blank();
  } catch {
    return blank();
  }
}

function tokCur(set) {
  return lsCur(LS_TOK, () => ({ b: 0, t: -1, f: -1, a: [], m: {} }), set);
}

function rememberTok(cur, t) {
  const a = t.address.toLowerCase();
  tokMeta.set(a, { symbol: t.symbol, decimals: t.decimals });
  if (!cur) return;
  cur.m = cur.m || {};
  cur.m[a] = [t.symbol, t.decimals, t.name || '', String(t.bal), t.usd];
}

function paintTokCache() {
  if (!aa) {
    renderHist();
    return false;
  }
  const cur = tokCur();
  renderHist();
  const rows = [];
  for (const a of cur.a || []) {
    const hit = (cur.m || {})[a];
    if (!hit) continue;
    tokMeta.set(a, { symbol: hit[0], decimals: +hit[1] });
    const wei = BigInt(hit[3] || '0');
    if (wei > 0n) rows.push({ address: a, symbol: hit[0], decimals: +hit[1], name: hit[2] || '', bal: wei, usd: hit[4] });
  }
  if (rows.length) {
    tokens = rows.sort((x, y) => (x.name || x.symbol).localeCompare(y.name || y.symbol));
    renderTokens();
  }
  if (cur.f >= 0) paintTokEmpty(cur.f <= (cur.b || 0) ? 'done' : 'budget', cur, { latest: cur.t, birth: cur.b });
  return !!(rows.length || (cur.a || []).length || ((histCur().h || []).length));
}

async function scanCtx() {
  const latest = Number(await jrpc(getRpcUrl(), 'eth_blockNumber', []));
  const fork = forkCfg();
  let birth = tokCur().b || histCur().b;
  if (fork) {
    const fb = Number(fork.fromBlock);
    birth = Number.isFinite(fb) && fb > 0 ? fb : latest;
  } else if (!birth) {
    try {
      birth = await accountBirth(aa, latest);
    } catch {
      // Non-archive public nodes fail the code walk, so birth stays unknown (0).
      // The first pass still caps itself to latest - LOGS_LOOKBACK inside
      // scanAccountLogs; older history resumes through Scan further.
      birth = 0;
    }
  }
  return { latest, birth, fork };
}

async function readErc20(addr, cur) {
  const a = String(addr).toLowerCase();
  const hit = cur && cur.m && cur.m[a];
  if (hit) {
    const bal = await call(addr, encodeBalanceOf(aa)).then(word).catch(() => 0n);
    const t = { address: addr, name: hit[2] || '', symbol: hit[0], decimals: Number(hit[1]) || 18, bal };
    rememberTok(cur, t);
    return t;
  }
  const [nm, sym, decRaw, bal] = await Promise.all([
    call(addr, '0x06fdde03').then(decodeStr).catch(() => ''),
    call(addr, '0x95d89b41').then(decodeStr).catch(() => ''),
    call(addr, '0x313ce567').then(word).catch(() => 18n),
    call(addr, encodeBalanceOf(aa)).then(word).catch(() => 0n),
  ]);
  const d = Number(decRaw);
  const t = {
    address: addr,
    name: nm.trim().slice(0, 48),
    symbol: (sym || addr.slice(0, 6)).slice(0, 12),
    decimals: d >= 0 && d <= 36 ? d : 18,
    bal,
  };
  rememberTok(cur, t);
  return t;
}

async function hydrateTokens(addrs, live) {
  const cur = tokCur();
  const rows = [];
  for (let i = 0; i < addrs.length; i += 8) {
    if (live && !live()) return;
    for (const t of await Promise.all(addrs.slice(i, i + 8).map((x) => readErc20(x, cur)))) if (t.bal > 0n) {
      rows.push(t);
    }
    tokens = rows.sort((x, y) => (x.name || x.symbol).localeCompare(y.name || y.symbol));
    renderTokens();
  }
  tokCur({ ...tokCur(), a: cur.a, m: cur.m });
}

/** High-cap tokens hold their balance in the contract, not in logs — probe them at head.
 *  Skipped on the local fork: the seeded list is the source of truth there. */
async function discoverMajors(cur, live) {
  if (forkCfg()) return false;
  const list = (CHAINS[chainId]?.majors || []).map((a) => a.toLowerCase()).filter((a) => !cur.a.includes(a));
  let found = false;
  for (let i = 0; i < list.length; i += 8) {
    if (live && !live()) return found;
    for (const t of await Promise.all(list.slice(i, i + 8).map((x) => readErc20(x, cur)))) {
      if (t.bal > 0n) {
        found = true;
        cur.a.push(t.address.toLowerCase());
        rememberTok(cur, t);
      }
    }
  }
  return found;
}

function tokScanHint(e) {
  const msg = (e && e.message) || 'Couldn’t list tokens.';
  if (pruneFloor(msg)) return PRUNE_HINT;
  const custom = rpcPaste();
  // getLogs already rewrites an all-stall scan into a Custom RPC pointer — don't suffix it twice.
  if (custom || alchOn() || timeoutLogsMsg(msg)) return msg;
  return msg + ' Custom RPC is in the header if a public node stalled.';
}

function collectTokLogs(cur, logs, fresh) {
  for (const l of logs || []) {
    if ((l.topics || []).length !== 3) continue;
    const a = '0x' + String(l.address).slice(-40).toLowerCase();
    if (!cur.a.includes(a)) {
      cur.a.push(a);
      if (fresh) fresh.push(a);
    }
  }
}

/**
 * Deep Transfer-in walk, decoupled from Activity: newest page first, from the
 * unscanned head and the persisted floor down toward birth. One budgeted pass at
 * a time; a fast (custom/archive) node keeps passing, a slow public hands back
 * with 'budget'. Nodes that cannot serve the range at all answer 'wall'.
 */
async function runTokWalk(scan, cur, live, quiet, older) {
  const custom = !!rpcPaste();
  const cfg = custom ? TOK_WALK_CUSTOM : TOK_WALK_PUBLIC;
  const deep = scan.latest - scan.birth > LOGS_LOOKBACK;
  const persist = () => tokCur({ b: scan.birth, t: cur.t, f: cur.f, a: cur.a, m: cur.m || {} });
  const haveFloor = cur.f >= 0;
  if (haveFloor && !older) {
    const needHead = cur.t + 1 <= scan.latest;
    if (!needHead) return cur.f <= scan.birth ? 'done' : 'budget';
    const budget = { pages: cfg.pages, ms: cfg.ms, t0: Date.now(), used: 0 };
    const fresh = [];
    try {
      await walkTransfersIn(cur.t + 1, scan.latest, aa, {
        budget,
        live,
        onPage: (logs, a, b) => {
          if (!live()) return;
          collectTokLogs(cur, logs, fresh);
          cur.t = b;
          persist();
        },
      });
    } catch (e) {
      if (e && e.unserved) return 'wall';
      throw e;
    }
    if (!live()) return 'done';
    if (fresh.length) await hydrateTokens(fresh, live);
    persist();
    return cur.f <= scan.birth ? 'done' : 'budget';
  }
  for (let pass = 0; pass < cfg.passes; pass++) {
    if (!live()) return 'done';
    const needHead = cur.f >= 0 && cur.t + 1 <= scan.latest;
    const top = cur.f >= 0 ? cur.f - 1 : scan.latest;
    if (!needHead && top < scan.birth) return 'done';
    if (!quiet && deep) setStatus(TOK_SCANNING);
    const budget = { pages: cfg.pages, ms: cfg.ms, t0: Date.now(), used: 0 };
    const fresh = [];
    let stopped = '';
    let done = false;
    try {
      if (needHead) {
        const r = await walkTransfersIn(cur.t + 1, scan.latest, aa, {
          budget,
          live,
          onPage: (logs, a, b) => {
            if (!live()) return;
            collectTokLogs(cur, logs, fresh);
            cur.t = b;
            persist();
            if (!quiet && deep) setStatus(`${TOK_SCANNING} ${a}`, 'wait');
          },
        });
        stopped = r.stopped;
        if (!live()) return 'done';
      }
      if (!stopped && top >= scan.birth) {
        const r = await walkTransfersIn(scan.birth, top, aa, {
          budget,
          descend: true,
          live,
          onPage: (logs, a, b) => {
            if (!live()) return;
            collectTokLogs(cur, logs, fresh);
            cur.f = a;
            if (cur.t < b) cur.t = b;
            persist();
            if (!quiet && deep) setStatus(`${TOK_SCANNING} ${a}`, 'wait');
          },
        });
        stopped = r.stopped;
        done = r.done;
      } else if (top < scan.birth) {
        done = !stopped;
      }
    } catch (e) {
      if (e && e.unserved) return 'wall';
      throw e;
    }
    if (!live()) return 'done';
    if (fresh.length) await hydrateTokens(fresh, live);
    if (done) return 'done';
    // A pass stopped by the clock means a slow node — hand back instead of looping.
    if (stopped !== 'pages') return 'budget';
  }
  return 'budget';
}

function paintTokEmpty(state, cur, scan) {
  const empty = $('tokEmpty');
  const more = $('tokMore');
  more.hidden = state !== 'budget';
  if (state === 'done') {
    empty.hidden = tokens.length > 0;
    empty.textContent = tokens.length ? '' : 'No tokens on this account yet.';
    return;
  }
  empty.hidden = false;
  empty.textContent = state === 'wall' ? TOK_WALL : cur.f >= 0 && cur.t >= scan.latest ? tokMoreHint(cur.f) : TOK_CATCHUP;
}

function paintTokMoreBusy(on) {
  const more = $('tokMore');
  more.disabled = on;
  more.setAttribute('aria-busy', on ? 'true' : 'false');
  more.textContent = on ? 'Scanning…' : 'Scan further';
}

async function discoverTokens(quiet, live, ctxP) {
  const empty = $('tokEmpty');
  if (alchOn() && aa) {
    try {
      const { rows, native } = await alchPortfolio(alchOn(), chainId, aa);
      if (!live()) return;
      ethUsd = native.usd || usdHold(word($('ethBal').dataset.wei), 18, native.px);
      paintEthUsd();
      const cur = tokCur();
      tokens = rows;
      for (const t of rows) {
        if (!cur.a.includes(t.address)) cur.a.push(t.address);
        rememberTok(cur, t);
      }
      tokCur({ b: cur.b || 0, t: 1, f: 0, a: cur.a, m: cur.m || {} });
      renderTokens();
      paintTokEmpty('done', tokCur(), { latest: 1, birth: 0 });
      $('tokMore').hidden = true;
      return;
    } catch (e) {
      if (!live()) return;
      if (!quiet) setStatus((e && e.message) || 'Alchemy tokens failed; scanning logs.', 'err');
    }
  }
  const cur = tokCur();
  if (typeof cur.f !== 'number') cur.f = -1;
  if (cur.f < 0) {
    empty.hidden = true;
    paintTokMoreBusy(false);
    $('tokMore').hidden = true;
  }
  const seeded = forkCfg();
  if (seeded?.tokens) {
    for (const t of seeded.tokens) {
      const a = String(t).toLowerCase();
      if (isAddress(a) && !cur.a.includes(a)) cur.a.push(a);
    }
  }
  const hydrateP = cur.a.length ? hydrateTokens(cur.a, live) : Promise.resolve();
  if (await discoverMajors(cur, live)) tokCur({ ...tokCur(), a: cur.a, m: cur.m });
  if (!live()) return;
  let scan;
  try {
    scan = await ctxP;
  } catch (e) {
    if (!live()) return;
    const hint = tokScanHint(e);
    empty.hidden = tokens.length > 0;
    empty.textContent = tokens.length ? '' : 'Couldn’t check for tokens just now.';
    if (!quiet) setStatus(hint, 'err');
    return;
  }
  if (!live()) return;
  await hydrateP;
  if (!live()) return;
  let state = 'done';
  if (scan.fork) {
    tokCur({ b: scan.birth, t: scan.latest, f: scan.birth, a: cur.a, m: cur.m || {} });
  } else {
    const first = cur.f < 0;
    if (first) paintTokMoreBusy(true);
    try {
      state = await runTokWalk(scan, cur, live, quiet, false);
    } catch (e) {
      if (!live()) return;
      const hint = tokScanHint(e);
      empty.hidden = tokens.length > 0;
      empty.textContent = tokens.length ? '' : 'Couldn’t check for tokens just now.';
      if (!quiet) setStatus(hint, 'err');
      return;
    } finally {
      if (first) paintTokMoreBusy(false);
    }
  }
  if (!live()) return;
  await hydrateTokens(cur.a, live);
  if (!live()) return;
  paintTokEmpty(state, cur, scan);
}

async function continueTokWalk() {
  if (!aa) return;
  const id = ++scanId;
  const mine = aa;
  const live = () => id === scanId && eq(aa, mine);
  const scan = await scanCtx();
  const cur = tokCur();
  paintTokMoreBusy(true);
  let state = 'budget';
  try {
    state = await runTokWalk(scan, cur, live, false, true);
  } catch (e) {
    if (live()) setStatus(tokScanHint(e), 'err');
    return;
  } finally {
    paintTokMoreBusy(false);
  }
  if (!live()) return;
  await hydrateTokens(cur.a, live);
  if (!live()) return;
  paintTokEmpty(state, cur, scan);
  if (lastKind === 'wait') setStatus('');
}

/** Blocks walked per Scan further pass (20 getLogs spans). */
const BACKFILL_SPAN = 200000;
let backfilling = false;

/** Activity frontier lives on the history cache; tokCur.f is the token walk's cursor. */
function histBound(hc) {
  return Math.max(hc.b || 0, hc.fl || 0);
}

function paintHistMore() {
  const btn = $('histMore');
  if (!btn) return;
  if (alchOn()) {
    btn.hidden = true;
    $('histFloor').hidden = true;
    return;
  }
  const hc = histCur();
  const f = Number.isFinite(hc.f) ? hc.f : -1;
  const more = !!aa && f > histBound(hc);
  btn.hidden = !more;
  const floored = !!aa && !more && (hc.fl || 0) > (hc.b || 0);
  const note = $('histFloor');
  note.hidden = !floored;
  if (floored) note.textContent = `This node keeps history from block ${hc.fl} on. Paste an archive RPC in the header for older activity.`;
}

/** Walk one span older than the scanned frontier, merging tokens and activity. */
async function backfill(quiet) {
  if (!aa || backfilling) return;
  const hc = histCur();
  const bound = histBound(hc);
  const f = Number.isFinite(hc.f) ? hc.f : -1;
  if (f <= bound) {
    paintHistMore();
    return;
  }
  backfilling = true;
  const btn = $('histMore');
  btn.disabled = true;
  const mine = aa;
  const live = () => eq(aa, mine);
  const lo = Math.max(bound, f - BACKFILL_SPAN);
  try {
    if (!quiet) setStatus(`Scanning blocks ${lo}–${f - 1}…`);
    const pack = await scanRangeLogs(lo, f - 1, mine);
    if (!live()) return;
    const eff = Math.max(lo, pack.floor || 0);
    const cur = tokCur();
    for (const l of pack.ins) {
      if ((l.topics || []).length !== 3) continue;
      const a = '0x' + String(l.address).slice(-40).toLowerCase();
      if (!cur.a.includes(a)) cur.a.push(a);
    }
    tokCur({ ...cur, a: cur.a });
    const hp = { ...histCur(), f: eff };
    if (pack.floor) hp.fl = pack.floor;
    histCur(hp);
    await backfillHist(pack, live);
    if (!live()) return;
    await hydrateTokens(cur.a, live);
    if (pack.floor) setStatus(`This node keeps history from block ${pack.floor} on. An archive Custom RPC goes further.`);
    else if (!quiet) setStatus(`Scanned back to block ${eff}.`, 'ok');
  } catch (e) {
    if (!quiet && live()) setStatus(e.message || 'Scan failed.', 'err');
    throw e;
  } finally {
    backfilling = false;
    btn.disabled = false;
    paintHistMore();
  }
}

/** Deep-receipts nodes keep walking on their own; shallow nodes wait for the button.
 *  Each pass strictly lowers the frontier or raises the floor, so this self-terminates. */
async function autoBackfill() {
  if (!rpcHasDeepLogs()) return;
  for (;;) {
    const hc = histCur();
    const f = Number.isFinite(hc.f) ? hc.f : -1;
    if (!aa || f <= histBound(hc)) break;
    try {
      await backfill(true);
    } catch {
      break;
    }
  }
}

async function refreshAccount(opts) {
  if (!eoa) return;
  const quiet = !!(opts && opts.quiet);
  if (!quiet) setStatus('Looking up your account…');
  await ensureRpc();
  const [eoaHex, factoryCode, legacyRaw] = await Promise.all([
    jrpc(getRpcUrl(), 'eth_getBalance', [eoa, 'latest']),
    jrpc(getRpcUrl(), 'eth_getCode', [ACCOUNT_FACTORY, 'latest']),
    call(KERNEL_FACTORY, encodeGetAccountAddress(eoa)),
  ]);
  eoaWei = word(eoaHex);
  factoryOnChain = hasCode(factoryCode);
  const legacyAddr = accountFromWord(legacyRaw);
  if (!legacyAddr) {
    aa = '';
    aaSource = '';
    aaRescue = false;
    legacyStranded = false;
    legacyRescueAddr = '';
    altAa = '';
    altSource = '';
    deployed = false;
    setAddr('aa', '');
    showSkill();
    throw new Error('Could not read the account address from the chain.');
  }
  const [legacyCode, legacyEthHex, legacyDepHex, ourRaw] = await Promise.all([
    jrpc(getRpcUrl(), 'eth_getCode', [legacyAddr, 'latest']),
    jrpc(getRpcUrl(), 'eth_getBalance', [legacyAddr, 'latest']),
    call(ENTRY_POINT, encodeBalanceOf(legacyAddr)),
    factoryOnChain ? call(ACCOUNT_FACTORY, encodeFactoryGetAccount(eoa)) : '0x',
  ]);
  const ourAddr = factoryOnChain ? accountFromWord(ourRaw) : '';
  if (factoryOnChain && !ourAddr) {
    aa = '';
    aaSource = '';
    aaRescue = false;
    legacyStranded = false;
    legacyRescueAddr = '';
    altAa = '';
    altSource = '';
    deployed = false;
    setAddr('aa', '');
    showSkill();
    throw new Error('Could not read the account address from the chain.');
  }
  const ourCode = ourAddr ? await jrpc(getRpcUrl(), 'eth_getCode', [ourAddr, 'latest']) : '0x';
  let ourEthHex = '0x0';
  let ourDepHex = '0x0';
  if (ourAddr && hasCode(ourCode)) {
    [ourEthHex, ourDepHex] = await Promise.all([
      jrpc(getRpcUrl(), 'eth_getBalance', [ourAddr, 'latest']),
      call(ENTRY_POINT, encodeBalanceOf(ourAddr)),
    ]);
  }
  const picked = pickAccount({
    legacyAddr,
    legacyCode,
    legacyEth: word(legacyEthHex),
    legacyDeposit: word(legacyDepHex),
    factoryOnChain,
    ourAddr,
    ourCode,
    ourEth: word(ourEthHex),
    ourDeposit: word(ourDepHex),
  });
  aa = picked.aa;
  aaSource = picked.source;
  aaRescue = picked.rescue;
  legacyStranded = picked.legacyStranded;
  legacyRescueAddr = picked.legacyStranded ? legacyAddr : '';
  altAa = picked.altAa || '';
  altSource = picked.altSource || '';
  deployed = picked.deployed;
  setAddr('aa', aa);
  const hadCache = paintTokCache();
  loadPendingTx();
  await checkPendingReceipt();
  let ethHex = '0x0';
  let depHex = '0x0';
  if (aa && eq(aa, legacyAddr)) {
    ethHex = legacyEthHex;
    depHex = legacyDepHex;
  } else if (aa) {
    [ethHex, depHex] = await Promise.all([
      jrpc(getRpcUrl(), 'eth_getBalance', [aa, 'latest']),
      call(ENTRY_POINT, encodeBalanceOf(aa)),
    ]);
  }
  implOk = true;
  maxPicks = Infinity;
  if (deployed) {
    const impl = await kernelImpl(aa);
    implOk = kernelExecImpl(impl);
    maxPicks = kernelBatchImpl(impl) ? Infinity : 1;
  }
  showSkill();
  const note = accountNote();
  $('aaNote').textContent = note.text;
  $('aaNote').className = note.err ? 'err' : 'muted';
  paintAlt();
  const eth = word(ethHex);
  const dep = word(depHex);
  $('ethBal').textContent = fmtEth(eth);
  $('ethBal').dataset.wei = String(eth);
  paintEthUsd();
  $('epBal').textContent = fmtEth(dep);
  $('epBal').dataset.wei = String(dep);
  resetFeeMemo();
  paintSelectAll();
  setGo();
  prefillMaxes().catch(() => {});
  const id = ++scanId;
  const live = () => id === scanId && aa;
  const keyed = alchOn();
  if (!quiet && !hadCache) {
    setStatus(
      keyed
        ? 'Reading tokens…'
        : chainId === 1 && !forkCfg() && tokCur().t < 0
          ? 'First scan can take a while. Custom RPC is there if a public node stalls…'
          : 'Reading tokens…'
    );
  }
  const emptyLogs = { ops: [], ins: [], outs: [], wds: [], rcv: [], clipped: false };
  const ctxP = scanCtx();
  const scanP = keyed
    ? ctxP.then((c) => ({ ...c, logs: emptyLogs }))
    : ctxP.then(async (c) => {
        const hcur = histCur();
        const stale = hcur.v !== HIST_V || (hcur.h || []).some((x) => x.hash && x.legs === undefined);
        const histFrom = !stale && hcur.t >= c.birth ? hcur.t + 1 : c.birth;
        if (histFrom > c.latest) return { ...c, logs: emptyLogs };
        const logs = logsFrom(await scanAccountLogs(histFrom, c.latest, aa), histFrom);
        return { ...c, logs };
      });
  await Promise.all([discoverTokens(quiet, live, ctxP), keyed ? discoverAlchHist(quiet, live) : discoverHist(quiet, live, scanP)]);
  if (!live()) return;
  const sp = await scanP;
  if (sp.logs && !sp.fork && !keyed) {
    const hc = histCur();
    const f = Math.min(Number.isFinite(hc.f) ? hc.f : Infinity, sp.logs.head ?? sp.latest + 1);
    if (f !== hc.f) histCur({ ...hc, f });
  }
  paintHistMore();
  if (!hadCache && !keyed) autoBackfill().catch(() => {});
  await prefillMaxes().catch(() => {});
  const clipped = !keyed && !!sp.logs?.clipped;
  if (quiet) return;
  if (eoaWei === 0n) {
    setStatus(EMPTY_WALLET, 'err');
  } else if (clipped) {
    setStatus(CLIP_HINT);
  } else if (lastKind !== 'err') {
    setStatus('');
  }
}

async function addToken() {
  const addr = $('tokenIn').value.trim();
  if (!isAddress(addr)) {
    setHint('tokenErr', 'Enter a token contract address.');
    return;
  }
  if (isBlockedDest(addr, aa)) {
    setHint('tokenErr', 'Use a token contract, not zero, ETH, or this account.');
    return;
  }
  setHint('tokenErr', '');
  const cur = tokCur();
  const t = await readErc20(addr.toLowerCase(), cur);
  tokens = tokens.filter((x) => !eq(x.address, t.address));
  if (t.bal > 0n) tokens.push(t);
  rememberTok(cur, t);
  if (!cur.a.some((x) => eq(x, t.address))) cur.a.push(t.address);
  tokCur({ ...cur, a: cur.a, m: cur.m });
  $('tokenIn').value = '';
  renderTokens();
  if (t.bal === 0n) setHint('tokenErr', 'This account holds none of that token.');
  else {
    t.keep = true;
    paintTokAdd(false);
  }
}

function spendableRows() {
  return [...$('assets').querySelectorAll('.tok')].filter((tok) => {
    const kind = tok.querySelector('[data-max]')?.dataset.max;
    if (kind === 'eth' || kind === 'ep') {
      const cap = tok.querySelector('[data-amt]')?.dataset.cap;
      if (cap != null) return word(cap) > 0n;
      return word($(kind === 'eth' ? 'ethBal' : 'epBal').dataset.wei) > 0n;
    }
    const t = tokens[+tok.querySelector('input[type="checkbox"]')?.dataset.i];
    return !!(t && t.bal > 0n);
  });
}

function paintEthUsd() {
  const el = $('ethBal');
  if (!el || el.dataset.wei == null) return;
  const eth = word(el.dataset.wei);
  el.textContent = fmtEth(eth) + (ethUsd ? ' · ' + fmtUsd(ethUsd) : '');
}

function paintTokUsd() {
  const el = $('tokUsd');
  if (!el) return;
  const n = (ethUsd || 0) + tokens.reduce((s, t) => s + (t.usd || 0), 0);
  el.hidden = !alchOn() || n <= 0;
  el.textContent = n > 0 ? fmtUsd(n) : '';
}

function paintDust() {
  const b = $('tokDust');
  if (!b) return;
  const on = !!alchOn() && tokens.some((t) => t.usd != null || t.px === 0);
  b.hidden = !on;
  b.setAttribute('aria-pressed', String(hideDust));
}

function paintPin(kind, on) {
  const v = kind === 'rpc' ? rpcPaste() : alchPaste();
  $(kind + 'Box').hidden = !on;
  $(kind + 'Add').setAttribute('aria-pressed', String(!!(on || v)));
  $(kind + 'Add').setAttribute('aria-expanded', String(!!on));
  if (on) {
    const other = kind === 'rpc' ? 'alch' : 'rpc';
    $(other + 'Box').hidden = true;
    $(other + 'Add').setAttribute('aria-expanded', 'false');
    $(other + 'Add').setAttribute('aria-pressed', String(!!(kind === 'rpc' ? alchPaste() : rpcPaste())));
    $(kind + 'In').focus();
  }
}

function paintTokAdd(on) {
  $('tokAdd').classList.toggle('on', !!on);
  const b = $('tokAdd').querySelector('.tok-add-open');
  b.setAttribute('aria-expanded', String(!!on));
  if (on) $('tokenIn').focus();
  else {
    $('tokenIn').value = '';
    setHint('tokenErr', '');
  }
}

function paintSelectAll() {
  const b = $('tokAll');
  if (!b) return;
  const rows = spendableRows();
  b.hidden = rows.length < 2 || maxPicks === 1;
  const all = rows.length > 0 && rows.every((r) => r.querySelector('input[type="checkbox"]')?.checked);
  b.textContent = all ? 'Clear' : 'Select all';
  b.setAttribute('aria-pressed', String(all));
}

async function toggleSelectAll() {
  if (maxPicks === 1) return;
  const rows = spendableRows();
  if (!rows.length) return;
  const all = rows.every((r) => r.querySelector('input[type="checkbox"]')?.checked);
  for (const r of rows) r.querySelector('input[type="checkbox"]').checked = !all;
  if (!all) await prefillMaxes({ overwrite: true }).catch(() => {});
  paintSelectAll();
  setGo();
}

function renderTokens() {
  const empty = $('tokEmpty');
  const shown = hideDust ? tokens.filter((t) => !dustTok(t, true)) : tokens;
  if (empty && shown.length) empty.hidden = true;
  const draft = new Map();
  for (const row of $('tokens').querySelectorAll('.tok')) {
    const i = +row.querySelector('input[type="checkbox"]')?.dataset.i;
    const t = tokens[i];
    if (!t) continue;
    draft.set(t.address.toLowerCase(), {
      on: row.querySelector('input[type="checkbox"]').checked,
      amt: row.querySelector('[data-amt]')?.value || '',
    });
  }
  $('tokens').innerHTML = shown
    .map((t) => {
      const i = tokens.indexOf(t);
      const d = draft.get(t.address.toLowerCase()) || { on: false, amt: '' };
      const nm = t.name && t.name !== t.symbol ? `${esc(t.name)} · ` : '';
      const val = t.usd != null && t.usd > 0 ? ` · ${fmtUsd(t.usd)}` : alchOn() && t.usd == null ? ' · —' : '';
      return `<div class="tok"><div class="tok-head"><label class="tok-pick"><input type="checkbox" data-i="${i}" ${d.on ? 'checked' : ''} /> <span class="tok-id"><span class="tok-sym">${esc(t.symbol)}</span></span></label><span class="tok-meta muted">${nm}${addrLineHtml(t.address, 'token')}</span></div><div class="ig"><input type="text" inputmode="decimal" placeholder="0" autocomplete="off" spellcheck="false" data-amt="tok" data-i="${i}" value="${esc(d.amt)}" /><button type="button" data-max="tok" data-i="${i}">Max</button></div><span class="mono">${esc(fmtAmt(t.bal, t.decimals, '', Infinity))}${esc(val)}</span></div>`;
    })
    .join('');
  if (empty && !shown.length && tokens.length && hideDust) {
    empty.hidden = false;
    empty.textContent = 'Dust and unpriced tokens hidden.';
  }
  paintTokUsd();
  paintDust();
  paintSelectAll();
  setGo();
}

async function refreshAfterSend() {
  try {
    await refreshAccount({ quiet: true });
  } catch {
    setStatus('Balances may be stale.');
  }
}

function paintTheme(light) {
  if (light) document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = light ? '#E8D4C8' : '#B85A3A';
  $('theme').setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
}

initHist({
  aa: () => aa,
  eoa: () => eoa,
  deployed: () => deployed,
  tokens: () => tokens,
  tokMeta,
  lsCur,
  setStatus,
  txHashHtml,
  explorerOpenHtml,
  addrLineHtml,
});
initSend({
  aa: () => aa,
  aaSource: () => aaSource,
  legacyStranded: () => legacyStranded,
  legacyAddr: () => legacyRescueAddr,
  eoa: () => eoa,
  deployed: () => deployed,
  implOk: () => implOk,
  maxPicks: () => maxPicks,
  sendOne: SEND_ONE,
  busy: () => busy,
  setBusy: (v) => {
    busy = v;
  },
  tokens: () => tokens,
  chainId: () => chainId,
  LS_RPC,
  wallet,
  ensureRpc,
  pendNs: () => (forkCfg() ? 'f-' : ''),
  setStatus,
  setHint,
  setGo,
  setReceipt,
  clearReceipt,
  txHashHtml,
  pushHist,
  refreshAfterSend,
  refreshAccount,
  paintSelectAll,
});

let themeLight = false;
try {
  themeLight = localStorage.getItem(LS_THEME) === 'light';
  hideDust = localStorage.getItem(LS_DUST) !== '0';
} catch {
  /* private */
}
paintTheme(themeLight);
$('theme').onclick = () => {
  themeLight = !themeLight;
  try {
    localStorage.setItem(LS_THEME, themeLight ? 'light' : 'dark');
  } catch {
    /* private */
  }
  paintTheme(themeLight);
};
const onConnectClick = () =>
  (eoa ? (confirm('Disconnect this wallet?') ? Promise.resolve(disconnect()) : Promise.resolve()) : connect()).catch((e) =>
    setStatus(e.message, 'err')
  );
$('connect').onclick = onConnectClick;
$('connectLand').onclick = onConnectClick;
$('note').onclick = (e) => {
  if (e.target !== e.currentTarget) return;
  if ($('note').classList.contains('wait')) return;
  setStatus('');
};
$('note').onkeydown = (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if ($('note').classList.contains('wait')) return;
  e.preventDefault();
  setStatus('');
};
$('note').onmouseenter = () => {
  if (!noteHold) return;
  clearTimeout(noteT);
};
$('note').onmouseleave = () => {
  if (!noteHold || !$('note').textContent) return;
  armNote(noteHold);
};
$('tabs').onclick = (e) => {
  const b = e.target.closest('[role="tab"]');
  if (b) paintTab(b.dataset.tab);
};
$('skillOpen').onclick = () => paintTab('skill');
$('skillBack').onclick = () => paintTab('wallet');
$('askList').onclick = (e) => {
  const btn = e.target.closest('.ask-sum');
  if (!btn || !$('askList').contains(btn)) return;
  const panel = $(btn.getAttribute('aria-controls'));
  if (!panel) return;
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  panel.hidden = open;
  btn.closest('.ask')?.toggleAttribute('data-open', !open);
};
$('tabs').onkeydown = (e) => {
  const order = ['wallet', 'activity', 'skill'];
  const i = order.indexOf(document.body.dataset.tab);
  if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
  e.preventDefault();
  const n = order[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
  paintTab(n);
  $('tab-' + n).focus();
};
$('c1').onclick = () => switchChain(1).catch((e) => setStatus(e.message, 'err'));
$('c8453').onclick = () => switchChain(8453).catch((e) => setStatus(e.message, 'err'));
$('addTok').onclick = () => addToken().catch((e) => setStatus(e.message, 'err'));
$('tokAdd').querySelector('.tok-add-open').onclick = () => paintTokAdd(true);
$('go').onclick = () => send().catch((e) => setStatus(sendFail(e), 'err'));
$('create').onclick = () => {
  createKernel().catch((e) => setStatus(e.message || 'Couldn’t create the account.', 'err'));
};
$('aaAct').onclick = () => {
  createKernel().catch((e) => setStatus(e.message || 'Couldn’t create the account.', 'err'));
};
$('destMe').onclick = () => fillDestMe();
$('destHint').onclick = () => fillDestMe(1);
$('tokAll').onclick = () => toggleSelectAll().catch((e) => setHint('amtErr', e.message || 'Couldn’t select.'));
$('tokMore').onclick = () => continueTokWalk().catch((e) => setStatus(e.message, 'err'));
$('copyAa').onclick = () => copyAa().catch((e) => setStatus(e.message, 'err'));
$('copySkill').onclick = () => copySkill().catch((e) => setStatus(e.message, 'err'));
$('copyHost').onclick = () => copyHost().catch((e) => setStatus(e.message, 'err'));
$('copyCast').onclick = () => copyCast().catch((e) => setStatus(e.message, 'err'));
$('histMore').onclick = () => backfill(false).catch(() => {});
$('hostSave').onclick = () => savePage().catch((e) => setStatus(e.message || 'Couldn’t save this page.', 'err'));
$('rpcAdd').onclick = () => paintPin('rpc', $('rpcBox').hidden);
$('alchAdd').onclick = () => paintPin('alch', $('alchBox').hidden);
$('rpcIn').onchange = () => {
  const v = $('rpcIn').value.trim();
  if (v) localStorage.setItem(LS_RPC + chainId, v);
  else localStorage.removeItem(LS_RPC + chainId);
  if (aa) {
    tokCur({ ...tokCur(), t: -1, f: -1 });
    const hc = histCur();
    delete hc.f;
    delete hc.fl;
    hc.t = -1;
    histCur(hc);
  }
  setRpcUrl('');
  paintPin('rpc', true);
  if (eoa) refreshAccount().catch((e) => setStatus(e.message, 'err'));
};
$('alchIn').onchange = () => {
  const v = alchKey($('alchIn').value);
  if (v) localStorage.setItem(LS_ALCH, v);
  else localStorage.removeItem(LS_ALCH);
  $('alchIn').value = v;
  if (aa) {
    tokCur({ ...tokCur(), t: -1, f: -1 });
    const hc = histCur();
    delete hc.f;
    delete hc.fl;
    hc.t = -1;
    histCur(hc);
  }
  ethUsd = 0;
  setRpcUrl('');
  paintPin('alch', true);
  if (eoa) refreshAccount().catch((e) => setStatus(e.message, 'err'));
};
$('rpcIn').onkeydown = (e) => {
  if (e.key === 'Escape') paintPin('rpc', false);
};
$('alchIn').onkeydown = (e) => {
  if (e.key === 'Escape') paintPin('alch', false);
};
$('tokDust').onclick = () => {
  hideDust = !hideDust;
  try {
    localStorage.setItem(LS_DUST, hideDust ? '1' : '0');
  } catch {
    /* private */
  }
  renderTokens();
};
$('dest').oninput = () => {
  paintDestErr();
  paintDestHint();
  setGo();
};
$('assets').onclick = (e) => {
  const b = e.target.closest('[data-max]');
  if (b) fillMax(b).catch((err) => setHint('amtErr', err.message || 'Couldn’t fill Max.'));
};
$('assets').oninput = () => {
  setHint('amtErr', '');
  setGo();
};
$('assets').onchange = (e) => {
  if (e.target.type === 'checkbox') {
    if (maxPicks === 1 && e.target.checked) {
      // Single-asset account: the new pick quietly replaces the old one.
      // The note only appears when the user actually tries to batch.
      let bumped = 0;
      for (const box of $('assets').querySelectorAll('input[type="checkbox"]')) {
        if (box !== e.target && box.checked) {
          box.checked = false;
          bumped++;
        }
      }
      if (bumped) setStatus(SEND_ONE);
    }
    prefillMaxes().catch((err) => setHint('amtErr', err.message || 'Couldn’t fill Max.'));
  }
  paintSelectAll();
  setGo();
};
$('assets').onkeydown = (e) => {
  if (e.target.id === 'tokenIn' || e.target.id === 'addTok') return;
  if (e.key === 'Enter' && !$('go').hidden) $('go').click();
};
$('tokenIn').oninput = () => setHint('tokenErr', '');
$('tokenIn').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    $('addTok').click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    paintTokAdd(false);
  }
};
setChainButtons();
markChain(chainId);
$('alchIn').value = localStorage.getItem(LS_ALCH) || '';
paintPin('alch', false);
paintPageHost();
loadSkill();
paintSelectAll();
placeConnect();
setGo();
