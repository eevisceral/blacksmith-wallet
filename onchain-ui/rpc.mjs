import {
  ENTRY_POINT,
  EIP1967_IMPL_SLOT,
  TRANSFER_TOPIC,
  USER_OP_TOPIC,
  WITHDRAWN_TOPIC,
  RECEIVED_TOPIC,
  topicAddress,
  parseRpcJson,
  ZERO_ADDR,
} from './kernel.mjs';
import { hex } from './util.mjs';

let rpcUrl = '';
let rpcAlts = [];
let rpcId = 1;

export const getRpcUrl = () => rpcUrl;
export const getRpcAlts = () => rpcAlts;
export const setRpcUrl = (u, alts) => {
  rpcUrl = u || '';
  rpcAlts = rpcUrl && Array.isArray(alts) ? alts.filter((x) => x && x !== rpcUrl) : [];
};

export function archiveLogsMsg(msg) {
  return /archive|personal token|historical state is not available/i.test(msg || '');
}

/** Receipts-pruning floor from a node error, e.g. "history is available from block 25735899". */
export function pruneFloor(msg) {
  const m = /available from block (\d+)/i.exec(msg || '');
  if (m) return Number(m[1]);
  return /pruning|pruned/i.test(msg || '') ? -1 : 0;
}

/** One toast for any pruning-floor failure, whichever surface catches it. */
export const PRUNE_HINT = 'This node keeps recent history only. An archive Custom RPC (header) goes further back.';

export function rangeLogsMsg(msg) {
  const s = msg || '';
  if (/rate limit|too many requests/i.test(s)) return false;
  return /block (range|span)|exceeds the limit|ranges over|too (large|many)|query returned more|-32005|invalid block params|limited to/i.test(s);
}

export function addrRequiredLogsMsg(msg) {
  return /specify an address/i.test(msg || '');
}

export function timeoutLogsMsg(msg) {
  return /timed out|timeout|was aborted/i.test(msg || '');
}

/** Node cannot serve that log range at all (pruned, method gone) — not a stall, not fatal. */
export function unservedLogsMsg(msg) {
  return /pruned history|method (not available|does not exist)/i.test(msg || '');
}

/** AbortSignal.timeout rejects as TimeoutError (Node says "signal timed out"); a fetch abort is AbortError. */
function timeoutErr(e) {
  const n = (e && e.name) || '';
  return n === 'TimeoutError' || n === 'AbortError' || timeoutLogsMsg((e && e.message) || '');
}

/** Transient upstream failure (relay timeout, 408/429/5xx, CORS-dropped fetch). */
export function transientRpcMsg(msg) {
  return /status code (408|429|5\d\d)|relay request failed|bad gateway|gateway timeout|service unavailable|request timeout|RPC HTTP (408|429|5\d\d)|failed to fetch|networkerror|load failed/i.test(
    msg || ''
  );
}

function rateLimited(msg) {
  return /too many requests|rate.?limit|RPC HTTP 429|status code 429/i.test(msg || '');
}

async function jrpcOnce(url, method, params, ms) {
  if (!url) throw new Error('No RPC URL.');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
    signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = parseRpcJson(text);
      if (j.error) throw new Error(j.error.message || 'RPC HTTP ' + r.status);
    } catch (e) {
      if (!/web page instead/i.test(String(e.message || ''))) throw e;
    }
    throw new Error('RPC HTTP ' + r.status);
  }
  const j = parseRpcJson(text);
  if (j.error) throw new Error(j.error.message || method);
  return j.result;
}

function sameUrlRetry(msg) {
  if (rateLimited(msg)) return false;
  return timeoutLogsMsg(msg) || transientRpcMsg(msg);
}

async function jrpcAt(url, method, params, ms) {
  try {
    return await jrpcOnce(url, method, params, ms);
  } catch (e) {
    if (!sameUrlRetry(e.message)) throw e;
    await new Promise((r) => setTimeout(r, 400));
    return jrpcOnce(url, method, params, ms);
  }
}

/** Timeout/5xx: one same-URL retry. 429: rotate immediately. Public reads then try alts. */
export async function jrpc(url, method, params, ms = 15000) {
  try {
    return await jrpcAt(url, method, params, ms);
  } catch (e) {
    if (!rpcAlts.length || url !== rpcUrl || logsKind(e) === 'fatal') throw e;
    for (const alt of rpcAlts.slice()) {
      try {
        const result = await jrpcAt(alt, method, params, ms);
        setRpcUrl(alt, [url, ...rpcAlts.filter((x) => x !== alt)]);
        return result;
      } catch {
        /* next alt */
      }
    }
    throw e;
  }
}

export async function call(to, data) {
  return jrpc(rpcUrl, 'eth_call', [{ to, data }, 'latest']);
}

export async function kernelImpl(addr, url) {
  return '0x' + String(await jrpc(url || rpcUrl, 'eth_getStorageAt', [addr, EIP1967_IMPL_SLOT, 'latest'])).slice(-40);
}

export function decodeStr(raw) {
  const h = (raw || '').replace(/^0x/i, '');
  if (!h || /^0+$/.test(h)) return '';
  if (h.length <= 64) {
    let s = '';
    for (let i = 0; i < h.length; i += 2) {
      const c = parseInt(h.slice(i, i + 2), 16);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  const len = Number(BigInt('0x' + h.slice(64, 128)));
  const data = h.slice(128, 128 + len * 2);
  let s = '';
  for (let i = 0; i < data.length; i += 2) s += String.fromCharCode(parseInt(data.slice(i, i + 2), 16));
  return s;
}

/** Inclusive span most free public nodes still serve (to - from === this). */
export const LOGS_RANGE_MAX = 9999;
/** Public scan window when birth/archive is unknown. */
export const LOGS_LOOKBACK = 120000;

function logsQuery(from, to, topics, addr) {
  const q = { fromBlock: hex(from), toBlock: hex(to), topics };
  if (addr) q.address = addr;
  return q;
}

function rpcUrls() {
  return rpcUrl ? [rpcUrl, ...rpcAlts] : [];
}

function logsKind(e) {
  const s = (e && e.message) || '';
  if (/unauthorized|Fork Error|web page instead/i.test(s)) return 'fatal';
  if (timeoutErr(e)) return 'stall';
  if (/rate limit|too many requests|overloaded|unknown block|RPC HTTP 403|failed to fetch|networkerror|load failed/i.test(s)) return 'next';
  if (transientRpcMsg(s)) return 'next';
  if (rangeLogsMsg(s) || addrRequiredLogsMsg(s) || archiveLogsMsg(s) || unservedLogsMsg(s) || pruneFloor(s)) return 'range';
  return 'fatal';
}

/** 2023-era blocks. Every block there has ERC-20 Transfers, so a node returning
 *  zero is lying about pruning; a pruned one errors. Either way: not deep. */
const DEEP_BLOCK = { 1: 17000000, 8453: 4000000 };
let rpcDeep = false;
/** Whether the picked node serves old receipts (full-history getLogs). */
export const rpcHasDeepLogs = () => rpcDeep;

/** Custom URL is exclusive (no public alts). Public URLs must serve unaddressed getLogs.
 *  Deep-receipts nodes win over head-only ones so 2023-era history scans work. */
export async function chooseRpc(id, custom, publics) {
  const want = hex(id).toLowerCase();
  const ok = async (u, logs) => {
    const cid = await jrpc(u, 'eth_chainId', [], 8000);
    if (String(cid).toLowerCase() !== want) throw new Error('wrong chain');
    await jrpc(u, 'eth_getBalance', [ZERO_ADDR, 'latest'], 8000);
    if (logs) {
      const bn = Number(await jrpc(u, 'eth_blockNumber', [], 8000));
      await jrpc(u, 'eth_getLogs', [{ fromBlock: hex(bn), toBlock: hex(bn), topics: [TRANSFER_TOPIC] }], 12000);
    }
    return u;
  };
  const deepAt = DEEP_BLOCK[id] || 0;
  const deepOk = async (u) => {
    if (!deepAt) return false;
    try {
      const logs = await jrpc(u, 'eth_getLogs', [{ fromBlock: hex(deepAt), toBlock: hex(deepAt), topics: [TRANSFER_TOPIC] }], 12000);
      return Array.isArray(logs) && logs.length > 0;
    } catch {
      return false;
    }
  };
  if (custom) {
    const url = await ok(custom, false);
    rpcDeep = await deepOk(url);
    setRpcUrl(url, []);
    return url;
  }
  let shallow = '';
  let last = new Error('No RPC URL.');
  for (const u of publics) {
    try {
      const url = await ok(u, true);
      if (await deepOk(url)) {
        rpcDeep = true;
        setRpcUrl(url, publics.filter((x) => x !== url));
        return url;
      }
      if (!shallow) shallow = url;
    } catch (e) {
      last = e;
    }
  }
  if (shallow) {
    rpcDeep = false;
    setRpcUrl(shallow, publics.filter((x) => x !== shallow));
    return shallow;
  }
  throw last;
}

async function getLogsAt(url, from, to, topics, addr, ms = 30000) {
  try {
    return await jrpcOnce(url, 'eth_getLogs', [logsQuery(from, to, topics, addr)], ms);
  } catch (e) {
    if (/unknown block/i.test(e.message || '') && to > from) {
      return jrpcOnce(url, 'eth_getLogs', [logsQuery(from, to - 1, topics, addr)], ms);
    }
    throw e;
  }
}

/** Every scan URL stalled. Public mode points at the header Custom RPC; raw abort text never reaches the page. */
export const LOGS_TIMEOUT_PUBLIC = 'Public nodes timed out. Custom RPC is in the header.';
export const LOGS_TIMEOUT_CUSTOM = 'That RPC timed out. Check the URL or paste another.';

export async function getLogs(from, to, topics, addr) {
  if (from > to) return [];
  return (await scanLogs(from, to, topics, addr)).logs;
}

function logsPageMs(budget) {
  if (!budget || budget.ms == null) return 30000;
  const remain = budget.ms - (Date.now() - budget.t0);
  if (remain <= 0) return 0;
  return Math.min(8000, Math.max(1200, remain));
}

/**
 * One paged getLogs loop: per-page URL failover, answering-URL promotion, optional
 * soft budget ({pages, ms, t0, used}) and per-page callback. `descend` walks newest
 * first so token discovery paints recent holdings before older history.
 */
async function scanLogs(from, to, topics, addr, opts) {
  const o = opts || {};
  const spans = [];
  for (let a = from; a <= to; a += LOGS_RANGE_MAX + 1) spans.push([a, Math.min(to, a + LOGS_RANGE_MAX)]);
  if (o.descend) spans.reverse();
  const order = rpcUrls();
  let last = new Error('No RPC URL.');
  let all = [];
  let stopped = '';
  for (const [a, b] of spans) {
    const budget = o.budget;
    if (budget) {
      if (budget.pages != null && budget.used >= budget.pages) {
        stopped = 'pages';
        break;
      }
      if (budget.ms != null && Date.now() - budget.t0 >= budget.ms) {
        stopped = 'ms';
        break;
      }
    }
    if (o.live && !o.live()) {
      stopped = 'halt';
      break;
    }
    let page;
    let ok = false;
    const kinds = [];
    for (const url of order.slice()) {
      const ms = logsPageMs(budget);
      if (budget && ms === 0) {
        stopped = 'ms';
        break;
      }
      try {
        page = await getLogsAt(url, a, b, topics, addr, ms);
        ok = true;
        // A URL that answered leads the remaining pages, so one staller stops taxing every page.
        if (url !== order[0]) order.unshift(order.splice(order.indexOf(url), 1)[0]);
        break;
      } catch (e) {
        last = e;
        const k = logsKind(e);
        if (k === 'fatal') throw e;
        kinds.push(k);
        const i = order.indexOf(url);
        if (i >= 0 && (k === 'next' || k === 'stall')) order.push(order.splice(i, 1)[0]);
      }
    }
    if (stopped) break;
    if (!ok) {
      if (budget && timeoutErr(last) && Date.now() - budget.t0 >= budget.ms) {
        stopped = 'ms';
        break;
      }
      if (timeoutErr(last)) throw new Error(order.length > 1 ? LOGS_TIMEOUT_PUBLIC : LOGS_TIMEOUT_CUSTOM);
      // Every URL refused this range outright — this node set cannot serve it (prune horizon, tiny range cap).
      if (kinds.length && kinds.every((k) => k === 'range')) last.unserved = true;
      throw last;
    }
    if (budget) budget.used += 1;
    all = all.concat(page);
    if (o.onPage) await o.onPage(page, a, b);
  }
  return { logs: all, stopped, done: !stopped };
}

/** Soft public budget keeps first paint from hanging on a birth→head walk; custom/archive walks further. */
export const TOK_WALK_PUBLIC = { pages: 30, ms: 15000, passes: 5 };
export const TOK_WALK_CUSTOM = { pages: 400, ms: 90000, passes: 25 };

/** ERC-20 `Transfer` to `aa`. No LOGS_LOOKBACK ceiling — the caller budgets and resumes via its cursor. */
export async function walkTransfersIn(from, to, aa, opts) {
  return scanLogs(from, to, [TRANSFER_TOPIC, null, topicAddress(aa)], null, opts);
}

export async function accountBirth(a, hi) {
  const at = async (b) => {
    const c = await jrpc(rpcUrl, 'eth_getCode', [a, hex(b)], 4000);
    return !!(c && c !== '0x' && c !== '0x0');
  };
  if (!(await at(hi))) return hi;
  let step = 1;
  let cur = hi;
  for (;;) {
    const n = cur > step ? cur - step : 0;
    if (!(await at(n))) {
      let lo = n;
      while (lo < cur) {
        const m = (lo + cur) >> 1;
        if (await at(m)) cur = m;
        else lo = m + 1;
      }
      return cur;
    }
    if (!n) return 0;
    cur = n;
    step *= 2;
  }
}

/** Explicit-range scan for Activity backfill. A pruning floor clamps the range instead of failing it. */
export async function scanRangeLogs(from, to, aa) {
  if (from > to) return { ops: [], ins: [], outs: [], wds: [], rcv: [], floor: 0 };
  const pad = topicAddress(aa);
  const run = (lo) =>
    Promise.all([
      getLogs(lo, to, [USER_OP_TOPIC, null, pad], ENTRY_POINT),
      getLogs(lo, to, [TRANSFER_TOPIC, null, pad]),
      getLogs(lo, to, [TRANSFER_TOPIC, pad]),
      getLogs(lo, to, [WITHDRAWN_TOPIC, pad], ENTRY_POINT),
      getLogs(lo, to, [RECEIVED_TOPIC], aa),
    ]);
  try {
    const [ops, ins, outs, wds, rcv] = await run(from);
    return { ops, ins, outs, wds, rcv, floor: 0 };
  } catch (e) {
    const f = pruneFloor(e.message);
    if (!f || f < 0 || f <= from || f > to) throw e;
    const [ops, ins, outs, wds, rcv] = await run(f);
    return { ops, ins, outs, wds, rcv, floor: f };
  }
}

/** Activity feed only — stays inside the recent LOGS_LOOKBACK window. Token discovery uses walkTransfersIn. */
export async function scanAccountLogs(from, latest, aa) {
  const head = latest - from > LOGS_LOOKBACK ? latest - LOGS_LOOKBACK : from;
  const r = await scanRangeLogs(head, latest, aa);
  const scanned = Math.max(head, r.floor || 0);
  return { ...r, clipped: scanned > from, head: scanned };
}

export function logsFrom(logs, from) {
  if (!logs) return logs;
  const keep = (l) => Number(l.blockNumber) >= from;
  return {
    ops: (logs.ops || []).filter(keep),
    ins: (logs.ins || []).filter(keep),
    outs: (logs.outs || []).filter(keep),
    wds: (logs.wds || []).filter(keep),
    rcv: (logs.rcv || []).filter(keep),
    clipped: !!logs.clipped,
  };
}
