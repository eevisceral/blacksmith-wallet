/** Thin Alchemy HTTP (no SDK). Key is exclusive JSON-RPC plus Portfolio / Transfers. */
import { jrpc } from './rpc.mjs';
import { word } from './util.mjs';

export const LS_ALCH = 'v1w-alch';
export const LS_DUST = 'v1w-dust';
/** Hide unpriced or sub-$1 ERC-20s (Alchemy has no ERC-20 spam flag). */
export const DUST_USD = 1;
export const ALCH_NET = { 1: 'eth-mainnet', 8453: 'base-mainnet' };

export function alchKey(s) {
  const t = String(s || '').trim();
  const m = t.match(/alchemy\.com\/v2\/([^/?#]+)/i);
  if (m) return m[1];
  if (/^https?:/i.test(t) || t.includes('/')) return '';
  return t.replace(/^Bearer\s+/i, '').trim();
}

export function alchRpc(key, chain) {
  const n = ALCH_NET[chain];
  const k = alchKey(key);
  return n && k ? `https://${n}.g.alchemy.com/v2/${k}` : '';
}

export async function alchPost(url, body, ms = 20000) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  let j = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Alchemy HTTP ' + r.status);
  }
  if (!r.ok || (j.error && !j.data)) throw new Error((j.error && (j.error.message || j.error)) || 'Alchemy HTTP ' + r.status);
  return j;
}

function usdPx(prices) {
  const hit = (prices || []).find((p) => /usd/i.test(p.currency)) || (prices || [])[0];
  const n = hit ? Number(hit.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function usdHold(bal, dec, px) {
  if (!px || bal <= 0n) return 0;
  const d = Number(dec) || 18;
  const s = bal.toString().padStart(d + 1, '0');
  return Number(`${s.slice(0, -d)}.${s.slice(-d)}`) * px;
}

export function fmtUsd(n) {
  if (n == null || !Number.isFinite(n) || n <= 0) return '';
  if (n < 0.01) return '<$0.01';
  if (n < 100) return '$' + n.toFixed(2);
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function dustTok(t, hide) {
  if (!hide || t.keep) return false;
  if (t.usd == null) return t.px != null;
  return t.usd < DUST_USD;
}

export function rowsFromPortfolio(tokens, net) {
  const native = { px: 0, usd: 0, wei: 0n };
  const rows = [];
  for (const t of tokens || []) {
    if (net && t.network && t.network !== net) continue;
    const px = usdPx(t.tokenPrices);
    const bal = word(t.tokenBalance);
    if (!t.tokenAddress) {
      native.px = px;
      native.wei = bal;
      native.usd = usdHold(bal, 18, px);
      continue;
    }
    if (bal <= 0n) continue;
    const m = t.tokenMetadata || {};
    const d = Number(m.decimals);
    const dec = d >= 0 && d <= 36 ? d : 18;
    rows.push({
      address: String(t.tokenAddress).toLowerCase(),
      name: (m.name || '').slice(0, 48),
      symbol: (m.symbol || String(t.tokenAddress).slice(0, 6)).slice(0, 12),
      decimals: dec,
      bal,
      px,
      usd: px ? usdHold(bal, dec, px) : null,
    });
  }
  rows.sort((a, b) => (b.usd || 0) - (a.usd || 0) || (a.name || a.symbol).localeCompare(b.name || b.symbol));
  return { rows, native };
}

export async function alchPortfolio(key, chain, addr) {
  const net = ALCH_NET[chain];
  if (!net) throw new Error('Alchemy is Ethereum and Base.');
  const k = alchKey(key);
  const tokens = [];
  let pageKey = '';
  do {
    const body = {
      addresses: [{ address: addr, networks: [net] }],
      withMetadata: true,
      withPrices: true,
      includeNativeTokens: true,
      includeErc20Tokens: true,
    };
    if (pageKey) body.pageKey = pageKey;
    const j = await alchPost(`https://api.g.alchemy.com/data/v1/${k}/assets/tokens/by-address`, body);
    const data = j.data || j;
    tokens.push(...(data.tokens || []));
    pageKey = data.pageKey || '';
  } while (pageKey && tokens.length < 500);
  return rowsFromPortfolio(tokens, net);
}

async function alchPages(rpc, extra) {
  const all = [];
  let pageKey = '';
  do {
    const r = await jrpc(rpc, 'alchemy_getAssetTransfers', [
      {
        fromBlock: '0x0',
        category: ['external', 'internal', 'erc20'],
        order: 'desc',
        maxCount: 100,
        withMetadata: true,
        excludeZeroValue: false,
        ...extra,
        ...(pageKey ? { pageKey } : {}),
      },
    ]);
    all.push(...(r.transfers || []));
    pageKey = r.pageKey || '';
  } while (pageKey && all.length < 256);
  return all;
}

export function xferLeg(t, aa) {
  const me = String(aa).toLowerCase();
  const to = String(t.to || '').toLowerCase();
  const from = String(t.from || '').toLowerCase();
  const d = to === me ? 1 : from === me ? -1 : 0;
  if (!d) return null;
  const raw = t.rawContract || {};
  const k = raw.address ? String(raw.address).toLowerCase() : 'eth';
  const dec = Number(raw.decimal);
  const ts = t.metadata && t.metadata.blockTimestamp ? Date.parse(t.metadata.blockTimestamp) / 1000 : 0;
  return {
    hash: t.hash,
    block: Number(t.blockNum),
    d,
    k,
    amt: String(word(raw.value || '0x0')),
    p: d === 1 ? from : to,
    sym: (t.asset || (k === 'eth' ? 'ETH' : k.slice(0, 6))).slice(0, 12),
    dec: Number.isFinite(dec) && dec >= 0 && dec <= 36 ? dec : 18,
    ts: Number.isFinite(ts) ? ts : 0,
  };
}

export async function alchTransfers(rpc, aa) {
  const [ins, outs] = await Promise.all([alchPages(rpc, { toAddress: aa }), alchPages(rpc, { fromAddress: aa })]);
  const seen = new Set();
  const legs = [];
  for (const t of ins.concat(outs)) {
    const id = t.uniqueId || `${t.hash}:${t.category}:${t.asset}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const g = xferLeg(t, aa);
    if (g) legs.push(g);
  }
  return legs;
}
