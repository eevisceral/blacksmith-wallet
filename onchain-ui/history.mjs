import {
  ENTRY_POINT,
  ZERO_ADDR,
  USER_OP_TOPIC,
  WITHDRAWN_TOPIC,
  parseUserOpEventData,
  parseWithdrawnData,
  parseReceivedData,
  logTopicAddr,
  topicAddress,
} from './kernel.mjs';
import { $, eq, hex, word, fmtAmt, fmtEth, fmtWhen, esc, LS_HIST } from './util.mjs';
import { jrpc, getRpcUrl, call, decodeStr, pruneFloor, PRUNE_HINT, getLogs, LOGS_LOOKBACK } from './rpc.mjs';
import { alchTransfers } from './alchemy.mjs';

export const HIST_CAP = 256;
export const HIST_V = 2;
export const HIST_TS = 24;

let S;

export function initHist(api) {
  S = api;
}

export function histCur(set) {
  return S.lsCur(LS_HIST, () => ({ b: 0, t: -1, h: [] }), set);
}

function histTitle(r) {
  const legs = r.legs || [];
  const failed = r.ok === false;
  if (!legs.length) return failed ? 'Failed send' : 'Send';
  const ins = legs.filter((x) => x.d === 1);
  const outs = legs.filter((x) => x.d === -1);
  const one = (xs) => (xs.length === 1 ? xs[0].sym : `${xs.length} assets`);
  if (ins.length && !outs.length) return failed ? 'Failed receive' : `Received ${one(ins)}`;
  if (outs.length && !ins.length) return failed ? 'Failed send' : `Sent ${one(outs)}`;
  return failed ? 'Failed send' : 'Send';
}

function histAmt(r) {
  const legs = r.legs || [];
  if (!legs.length) return '';
  if (legs.length === 1) {
    const x = legs[0];
    const n = fmtAmt(BigInt(x.amt || '0'), x.dec || 18, x.sym || '');
    return (x.d === 1 ? '+' : '−') + n;
  }
  return legs.map((x) => `${x.d === 1 ? '+' : '−'}${fmtAmt(BigInt(x.amt || '0'), x.dec || 18, x.sym || '')}`).join(' · ');
}

export function renderHist() {
  const aa = S.aa();
  const rows = (aa ? histCur().h : []) || [];
  $('hist').innerHTML = rows
    .map((r) => {
      const when = fmtWhen(r.ts) || (r.block && r.block < 1e15 ? `block ${r.block}` : '');
      const legs = r.legs || [];
      const p = (legs[0] || {}).p;
      const all = p && legs.every((x) => eq(x.p, p));
      const who = all
        ? S.eoa() && eq(p, S.eoa())
          ? `<span class="tok-addr-line"><span title="${esc(p)}">your wallet</span>${S.explorerOpenHtml(p, 'address')}</span>`
          : S.addrLineHtml(p)
        : '';
      const peer = who ? `${legs[0].d === 1 ? 'from' : 'to'} ${who}` : '';
      const gas = r.gas && r.gas !== '0' ? `gas ${fmtEth(BigInt(r.gas))}` : '';
      const hash = S.txHashHtml(r.hash);
      const bits = [peer, when ? esc(when) : '', gas ? esc(gas) : '', hash].filter(Boolean);
      const fail = r.ok === false ? ' fail' : '';
      const inn = (r.legs || []).length && (r.legs || []).every((x) => x.d === 1) ? ' in' : '';
      const meta = bits.length ? `<span class="tok-meta muted">${bits.join(' · ')}</span>` : '';
      return `<li class="${(fail + inn).trim()}"><span class="hist-ttl">${esc(histTitle(r))}</span><span class="mono hist-amt">${esc(histAmt(r))}</span>${meta}</li>`;
    })
    .join('');
  $('histEmpty').hidden = rows.length > 0;
}

export function pushHist(hash, picks, dest) {
  const aa = S.aa();
  if (!hash || !aa) return;
  const legs = (picks || []).map((p) => ({
    d: -1,
    sym: p.kind === 'ep' ? 'prepaid gas' : p.label || p.token?.symbol || 'ETH',
    dec: p.decimals || 18,
    amt: String(p.amount),
    p: dest || '',
    k: p.kind === 'tok' ? p.token.address : p.kind,
  }));
  const ts = Math.floor(Date.now() / 1000);
  // Queued behind any in-flight merge so a scan cannot overwrite a pending send.
  mergeQ = mergeQ.catch(() => {}).then(() => {
    const cur = histCur();
    const h = (cur.h || []).filter((x) => !eq(x.hash, hash));
    h.unshift({ hash, kind: 'Send', block: 1e15, ts, ok: true, legs });
    histCur({ ...cur, h: h.slice(0, HIST_CAP) });
    renderHist();
  });
}

async function labelTok(addr) {
  const a = addr.toLowerCase();
  const tokMeta = S.tokMeta;
  if (tokMeta.has(a)) return tokMeta.get(a);
  const hit = S.tokens().find((t) => eq(t.address, a));
  if (hit) {
    const m = { symbol: hit.symbol, decimals: hit.decimals };
    tokMeta.set(a, m);
    return m;
  }
  const [sym, decRaw] = await Promise.all([
    call(addr, '0x95d89b41').then(decodeStr).catch(() => ''),
    call(addr, '0x313ce567').then(word).catch(() => 18n),
  ]);
  const d = Number(decRaw);
  const m = { symbol: (sym || addr.slice(0, 6)).slice(0, 12), decimals: d >= 0 && d <= 36 ? d : 18 };
  tokMeta.set(a, m);
  return m;
}

function xferLeg(log, dir) {
  if ((log.topics || []).length !== 3) return null;
  const aa = S.aa();
  const peer = logTopicAddr(log.topics[dir === 1 ? 1 : 2]);
  if (eq(peer, aa)) return null;
  return {
    hash: log.transactionHash,
    block: Number(log.blockNumber),
    d: dir,
    token: String(log.address).toLowerCase(),
    amt: String(word(log.data)),
    p: eq(peer, ZERO_ADDR) ? '' : peer,
  };
}

/** Alchemy Transfers API (ETH + ERC-20, including calldata ETH) plus EntryPoint UserOp/Withdrawn logs. */
export async function discoverAlchHist(quiet, live) {
  const aa = S.aa();
  if (!aa) {
    renderHist();
    return;
  }
  renderHist();
  const latest = Number(await jrpc(getRpcUrl(), 'eth_blockNumber', []));
  const head = Math.max(0, latest - LOGS_LOOKBACK);
  const pad = topicAddress(aa);
  const [legs, ops, wds] = await Promise.all([
    alchTransfers(getRpcUrl(), aa),
    getLogs(head, latest, [USER_OP_TOPIC, null, pad], ENTRY_POINT).catch(() => []),
    getLogs(head, latest, [WITHDRAWN_TOPIC, pad], ENTRY_POINT).catch(() => []),
  ]);
  if (!live()) return;
  await mergeHistLogs({ ops, ins: [], outs: [], wds, rcv: [], legs }, quiet, live, { b: 0, t: latest, f: 0, v: HIST_V, replace: true });
}

export async function discoverHist(quiet, live, scanP) {
  const aa = S.aa();
  if (!aa) {
    renderHist();
    return;
  }
  renderHist();
  const scan = await scanP;
  if (!live()) return;
  const cur = histCur();
  const stale = cur.v !== HIST_V || (cur.h || []).some((x) => x.hash && x.legs === undefined);
  const from = !stale && cur.t >= scan.birth ? cur.t + 1 : scan.birth;
  if (from > scan.latest) return;
  const pack = scan.logs;
  if (!pack) return;
  await mergeHistLogs(pack, quiet, live, { b: scan.birth, t: scan.latest });
}

/** Merge an older-range pack without moving the head cursor (Scan further). */
export async function backfillHist(pack, live) {
  await mergeHistLogs(pack, true, live, {});
}

/* Merges are async read-modify-write on the same cache; serialize them so a
 * head scan and a Scan further pass cannot drop each other's rows. */
let mergeQ = Promise.resolve();

async function mergeHistLogs(pack, quiet, live, patch) {
  const p = mergeQ.catch(() => {}).then(() => mergeHistLogsInner(pack, quiet, live, patch));
  mergeQ = p.catch(() => {});
  return p;
}

async function mergeHistLogsInner(pack, quiet, live, patch) {
  const cur = histCur();
  try {
    const { ops = [], ins = [], outs = [], wds = [], rcv = [] } = pack;
    const aa = S.aa();
    if (!live()) return;
    const seen = new Map(patch.replace ? [] : (cur.h || []).map((x) => [String(x.hash).toLowerCase(), { ...x }]));
    const legsBy = new Map();
    const addLeg = (hash, block, leg) => {
      if (!hash) return;
      const k = hash.toLowerCase();
      const r = seen.get(k) || { hash, ok: true, legs: [] };
      r.hash = r.hash || hash;
      r.block = Math.max(r.block || 0, block || 0);
      const arr = legsBy.get(k) || [];
      arr.push(leg);
      legsBy.set(k, arr);
      seen.set(k, r);
    };
    for (const l of ops) {
      const hash = l.transactionHash;
      if (!hash) continue;
      const p = parseUserOpEventData(l.data);
      const k = hash.toLowerCase();
      const r = seen.get(k) || { hash, legs: [] };
      r.block = Number(l.blockNumber);
      r.ok = p ? p.ok : r.ok;
      r.nonce = p ? String(p.nonce) : r.nonce;
      r.gas = p ? String(p.gasCost) : r.gas;
      r.legs = r.legs || [];
      seen.set(k, r);
    }
    for (const l of ins) {
      const g = xferLeg(l, 1);
      if (g) addLeg(g.hash, g.block, { d: 1, k: g.token, amt: g.amt, p: g.p });
    }
    for (const l of outs) {
      const g = xferLeg(l, -1);
      if (g) addLeg(g.hash, g.block, { d: -1, k: g.token, amt: g.amt, p: g.p });
    }
    for (const l of wds) {
      const w = parseWithdrawnData(l.data);
      if (!w || !l.transactionHash) continue;
      addLeg(l.transactionHash, Number(l.blockNumber), { d: -1, k: 'ep', amt: String(w.amount), p: w.to, sym: 'prepaid gas', dec: 18 });
    }
    for (const l of rcv) {
      const g = parseReceivedData(l.data);
      if (!g || !l.transactionHash || eq(g.from, aa)) continue;
      addLeg(l.transactionHash, Number(l.blockNumber), { d: 1, k: 'eth', amt: String(g.amount), p: g.from });
    }
    for (const g of pack.legs || []) {
      addLeg(g.hash, g.block, { d: g.d, k: g.k, amt: g.amt, p: g.p, sym: g.sym, dec: g.dec, ts: g.ts });
    }
    const need = new Set();
    for (const legs of legsBy.values()) for (const x of legs) if (x.k && x.k.startsWith('0x')) need.add(x.k);
    await Promise.all([...need].map(labelTok));
    const tokMeta = S.tokMeta;
    const tokens = S.tokens();
    for (const [k, legs] of legsBy) {
      const r = seen.get(k);
      r.legs = legs.map((x) => {
        if (x.k === 'ep') return { d: x.d, sym: 'prepaid gas', dec: 18, amt: x.amt, p: x.p, k: 'ep' };
        if (x.k === 'eth') return { d: x.d, sym: x.sym || 'ETH', dec: x.dec || 18, amt: x.amt, p: x.p, k: 'eth' };
        const m = tokMeta.get(x.k) || tokens.find((t) => eq(t.address, x.k)) || { symbol: x.sym || x.k.slice(0, 6), decimals: x.dec || 18 };
        return { d: x.d, sym: m.symbol, dec: m.decimals, amt: x.amt, p: x.p, k: x.k };
      });
    }
    const h0 = [...seen.values()].sort((a, b) => (b.block || 0) - (a.block || 0)).slice(0, HIST_CAP);
    const times = new Map();
    const needTs = [];
    for (const r of h0) {
      if (needTs.length >= HIST_TS) break;
      const b = r.block;
      if (b && b < 1e15 && !r.ts && !needTs.includes(b)) needTs.push(b);
    }
    // at most HIST_TS block headers per scan — 256 parallel getBlockByNumber melts public RPCs
    await Promise.all(
      needTs.map(async (b) => {
        try {
          const blk = await jrpc(getRpcUrl(), 'eth_getBlockByNumber', [hex(b), false]);
          if (blk?.timestamp) times.set(b, Number(blk.timestamp));
        } catch {
          /* public nodes may omit old blocks */
        }
      })
    );
    for (const r of h0) {
      if (times.has(r.block)) r.ts = times.get(r.block);
      else if (!r.ts) {
        const legTs = (legsBy.get(String(r.hash).toLowerCase()) || []).map((x) => x.ts).find(Boolean);
        if (legTs) r.ts = legTs;
      }
    }
    if (!live()) return;
    histCur({ ...cur, ...patch, v: HIST_V, h: h0, replace: undefined });
    renderHist();
  } catch (e) {
    if (quiet) return;
    // Same copy as the token scan path so a shared scan failure is one toast, not two.
    S.setStatus(pruneFloor(e.message) ? PRUNE_HINT : e.message || 'Couldn’t load activity.', 'err');
  }
}
