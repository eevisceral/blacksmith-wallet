/**
 * Agent spend policy. Loaded from BLACKSMITH_POLICY or ~/.blacksmith/policy.json.
 * Live handleOps is gated here — keys never appear in results.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAddress } from '../onchain-ui/kernel.mjs';
import { decodeCallData } from './tools-decode.mjs';

const drySeen = new Set();

export function blacksmithHome() {
  return process.env.BLACKSMITH_HOME || join(homedir(), '.blacksmith');
}

export function policyPath() {
  return process.env.BLACKSMITH_POLICY || join(blacksmithHome(), 'policy.json');
}

export function loadPolicy() {
  const p = policyPath();
  if (!existsSync(p)) {
    return {
      max_native_wei: null,
      max_erc20: {},
      allow_recipients: [],
      require_dry_run_first: true,
      path: p,
      missing: true,
    };
  }
  let j;
  try {
    j = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    throw new Error('policy.json is not valid JSON.');
  }
  const allow = Array.isArray(j.allow_recipients) ? j.allow_recipients.map((a) => String(a).toLowerCase()).filter(isAddress) : [];
  const maxErc = {};
  if (j.max_erc20 && typeof j.max_erc20 === 'object') {
    for (const [k, v] of Object.entries(j.max_erc20)) {
      if (isAddress(k)) maxErc[k.toLowerCase()] = BigInt(v);
    }
  }
  return {
    max_native_wei: j.max_native_wei == null || j.max_native_wei === '' ? null : BigInt(j.max_native_wei),
    max_erc20: maxErc,
    allow_recipients: allow,
    require_dry_run_first: j.require_dry_run_first !== false,
    path: p,
    missing: false,
  };
}

export function markDryRun(userOpHash) {
  drySeen.add(String(userOpHash).toLowerCase());
}

export function sawDryRun(userOpHash) {
  return drySeen.has(String(userOpHash).toLowerCase());
}

function innerRecipients(call) {
  const data = String(call.data || '0x');
  const h = data.replace(/^0x/i, '');
  const sel = h.slice(0, 8);
  if (sel === 'a9059cbb' && h.length >= 136) return ['0x' + h.slice(32, 72), call.to];
  if (sel === '205c2878' && h.length >= 136) return ['0x' + h.slice(32, 72)];
  return [call.to];
}

export function policyCheck(op, policy = loadPolicy()) {
  const decoded = decodeCallData(op.callData);
  const calls = decoded.calls || [];
  const recips = new Set();
  let native = 0n;
  const erc = new Map();
  for (const c of calls) {
    native += BigInt(c.value || 0n);
    for (const r of innerRecipients(c)) if (r) recips.add(String(r).toLowerCase());
    const h = String(c.data || '').replace(/^0x/i, '');
    if (h.slice(0, 8) === 'a9059cbb' && h.length >= 136) {
      const amt = BigInt('0x' + h.slice(72, 136));
      const tok = String(c.to).toLowerCase();
      erc.set(tok, (erc.get(tok) || 0n) + amt);
    }
    if (h.slice(0, 8) === '205c2878' && h.length >= 136) native += BigInt('0x' + h.slice(72, 136));
  }
  if (policy.allow_recipients.length) {
    for (const r of recips) {
      if (!policy.allow_recipients.includes(r)) {
        return `policy: recipient ${r} is not on the allowlist.`;
      }
    }
  }
  if (policy.max_native_wei != null && native > policy.max_native_wei) {
    return `policy: native+deposit out ${native} wei exceeds max_native_wei ${policy.max_native_wei}.`;
  }
  for (const [t, amt] of erc) {
    if (policy.max_erc20[t] != null && amt > policy.max_erc20[t]) {
      return `policy: token ${t} amount ${amt} exceeds max_erc20.`;
    }
  }
  return '';
}

export function sessionCovers(op, session) {
  if (!session) return 'no session key';
  const now = Math.floor(Date.now() / 1000);
  if (session.validAfter && now < Number(session.validAfter)) return 'session not yet valid';
  if (session.validUntil && Number(session.validUntil) < 0xfffffffffffe && now > Number(session.validUntil)) {
    return 'session expired';
  }
  if (session.unrestricted) return '';
  const decoded = decodeCallData(op.callData);
  const calls = decoded.calls || [];
  const targets = (session.targets || []).map((t) => String(t).toLowerCase());
  const sels = (session.selectors || []).map((s) => String(s).replace(/^0x/i, '').toLowerCase().padEnd(8, '0').slice(0, 8));
  const maxVal = session.valueLimit == null ? null : BigInt(session.valueLimit);
  for (const c of calls) {
    if (targets.length && !targets.includes(String(c.to).toLowerCase())) return `session: target ${c.to} not allowed`;
    if (maxVal != null && BigInt(c.value || 0) > maxVal) return 'session: value exceeds limit';
    const sel = String(c.data || '0x')
      .replace(/^0x/i, '')
      .slice(0, 8)
      .padEnd(8, '0');
    if (sels.length && sel !== '00000000' && !sels.includes(sel)) return `session: selector 0x${sel} not allowed`;
  }
  return '';
}
