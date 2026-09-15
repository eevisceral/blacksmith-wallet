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

export function rangeLogsMsg(msg) {
  const s = msg || '';
  if (/rate limit|too many requests/i.test(s)) return false;
  return /block (range|span)|exceeds the limit|ranges over|too (large|many)|query returned more|-32005|invalid block params|limited to/i.test(s);
}

export function addrRequiredLogsMsg(msg) {
  return /specify an address/i.test(msg || '');
}

export async function jrpc(url, method, params, ms = 15000) {
  if (!url) throw new Error('No RPC URL.');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
    signal: AbortSignal.timeout(ms),
  });
  const j = parseRpcJson(await r.text());
  if (j.error) throw new Error(j.error.message || method);
  if (!r.ok) throw new Error('RPC HTTP ' + r.status);
  return j.result;
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

function logsKind(msg) {
  const s = msg || '';
  if (/unauthorized|Fork Error|web page instead/i.test(s)) return 'fatal';
  if (/rate limit|too many requests|overloaded|unknown block|RPC HTTP 403/i.test(s)) return 'next';
  if (rangeLogsMsg(s) || addrRequiredLogsMsg(s) || archiveLogsMsg(s)) return 'next';
  return 'fatal';
}

/** Custom URL is exclusive (no public alts). Public URLs must serve unaddressed getLogs. */
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
  if (custom) {
    const url = await ok(custom, false);
    setRpcUrl(url, []);
    return url;
  }
  let last = new Error('No RPC URL.');
  for (const u of publics) {
    try {
      const url = await ok(u, true);
      setRpcUrl(url, publics.filter((x) => x !== url));
      return url;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function getLogsAt(url, from, to, topics, addr) {
  try {
    return await jrpc(url, 'eth_getLogs', [logsQuery(from, to, topics, addr)], 30000);
  } catch (e) {
    if (/unknown block/i.test(e.message || '') && to > from) {
      return jrpc(url, 'eth_getLogs', [logsQuery(from, to - 1, topics, addr)], 30000);
    }
    throw e;
  }
}

export async function getLogs(from, to, topics, addr) {
  if (from > to) return [];
  if (to - from > LOGS_RANGE_MAX) {
    let all = [];
    for (let a = from; a <= to; a += LOGS_RANGE_MAX + 1) {
      all = all.concat(await getLogs(a, Math.min(to, a + LOGS_RANGE_MAX), topics, addr));
    }
    return all;
  }
  const urls = rpcUrls();
  let last = new Error('No RPC URL.');
  for (const url of urls) {
    try {
      return await getLogsAt(url, from, to, topics, addr);
    } catch (e) {
      last = e;
      if (logsKind(e.message || '') === 'fatal') throw e;
    }
  }
  throw last;
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

/** Token discovery + Activity. Caps to LOGS_LOOKBACK once. */
export async function scanAccountLogs(from, latest, aa) {
  const pad = topicAddress(aa);
  const head = latest - from > LOGS_LOOKBACK ? latest - LOGS_LOOKBACK : from;
  const [ops, ins, outs, wds, rcv] = await Promise.all([
    getLogs(head, latest, [USER_OP_TOPIC, null, pad], ENTRY_POINT),
    getLogs(head, latest, [TRANSFER_TOPIC, null, pad]),
    getLogs(head, latest, [TRANSFER_TOPIC, pad]),
    getLogs(head, latest, [WITHDRAWN_TOPIC, pad], ENTRY_POINT),
    getLogs(head, latest, [RECEIVED_TOPIC], aa),
  ]);
  return { ops, ins, outs, wds, rcv, clipped: head > from };
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
