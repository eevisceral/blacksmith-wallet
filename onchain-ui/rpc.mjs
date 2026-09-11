import {
  ENTRY_POINT,
  EIP1967_IMPL_SLOT,
  TRANSFER_TOPIC,
  USER_OP_TOPIC,
  WITHDRAWN_TOPIC,
  RECEIVED_TOPIC,
  topicAddress,
  parseRpcJson,
} from './kernel.mjs';
import { hex } from './util.mjs';

let rpcUrl = '';
let rpcId = 1;

export const getRpcUrl = () => rpcUrl;
export const setRpcUrl = (u) => {
  rpcUrl = u || '';
};

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

export async function getLogs(from, to, topics, addr) {
  try {
    const q = { fromBlock: hex(from), toBlock: hex(to), topics };
    if (addr) q.address = addr;
    return await jrpc(rpcUrl, 'eth_getLogs', [q], 30000);
  } catch (e) {
    const msg = e.message || '';
    if (/archive|personal token|403|unauthorized|Fork Error|web page instead/i.test(msg)) throw e;
    if (/unknown block/i.test(msg) && to > from + 1) {
      const lag = Math.max(from, to - 64);
      return getLogs(from, lag, topics, addr);
    }
    if (from >= to || !/range|limit|too (large|many)|query returned more|block range|-32005/i.test(msg)) throw e;
    const mid = (from + to) >> 1;
    return (await getLogs(from, mid, topics, addr)).concat(await getLogs(mid + 1, to, topics, addr));
  }
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

/** One archive walk for token discovery + Activity. */
export async function scanAccountLogs(from, latest, aa) {
  const pad = topicAddress(aa);
  const [ops, ins, outs, wds, rcv] = await Promise.all([
    getLogs(from, latest, [USER_OP_TOPIC, null, pad], ENTRY_POINT),
    getLogs(from, latest, [TRANSFER_TOPIC, null, pad]),
    getLogs(from, latest, [TRANSFER_TOPIC, pad]),
    getLogs(from, latest, [WITHDRAWN_TOPIC, pad], ENTRY_POINT),
    getLogs(from, latest, [RECEIVED_TOPIC], aa),
  ]);
  return { ops, ins, outs, wds, rcv };
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
  };
}
