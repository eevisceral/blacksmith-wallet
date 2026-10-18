import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
      allow_arbitrary_calls: false,
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
    allow_arbitrary_calls: j.allow_arbitrary_calls === true,
    path: p,
    missing: false,
  };
}

function dryPath() {
  return join(blacksmithHome(), 'dry-runs.json');
}

function loadDryDisk() {
  try {
    const j = JSON.parse(readFileSync(dryPath(), 'utf8'));
    const now = Date.now();
    const keep = {};
    for (const [h, t] of Object.entries(j && typeof j === 'object' ? j : {})) {
      const ts = Number(t);
      if (h && ts && now - ts < 24 * 60 * 60 * 1000) keep[h.toLowerCase()] = ts;
    }
    return keep;
  } catch {
    return {};
  }
}

export function markDryRun(userOpHash) {
  const h = String(userOpHash).toLowerCase();
  drySeen.add(h);
  try {
    const keep = loadDryDisk();
    keep[h] = Date.now();
    const keys = Object.keys(keep);
    if (keys.length > 64) {
      keys.sort((a, b) => keep[a] - keep[b]);
      for (const k of keys.slice(0, keys.length - 64)) delete keep[k];
    }
    mkdirSync(dirname(dryPath()), { recursive: true });
    writeFileSync(dryPath(), JSON.stringify(keep) + '\n', { mode: 0o600 });
  } catch {
  }
}

export function sawDryRun(userOpHash) {
  const h = String(userOpHash).toLowerCase();
  if (drySeen.has(h)) return true;
  return h in loadDryDisk();
}

const TRANSFER_SEL = 'a9059cbb';
const APPROVE_SEL = '095ea7b3';
const INCREASE_SEL = '39509351';
const WITHDRAW_SEL = '205c2878';

function wordAmt(h, at) {
  return BigInt('0x' + h.slice(at, at + 64));
}

function innerRecipients(call) {
  const h = String(call.data || '0x').replace(/^0x/i, '');
  const sel = h.slice(0, 8);
  if ((sel === TRANSFER_SEL || sel === APPROVE_SEL || sel === INCREASE_SEL) && h.length >= 136) {
    return ['0x' + h.slice(32, 72), call.to];
  }
  if (sel === WITHDRAW_SEL && h.length >= 136) return ['0x' + h.slice(32, 72)];
  return [call.to];
}

export function policyCheck(op, policy = loadPolicy()) {
  if (!policy || policy.missing) return 'policy: no policy.json. Copy mcp/policy.example.json and set allow_recipients before signing.';
  if (!policy.allow_recipients.length) return 'policy: allow_recipients is empty. Name every address this agent may pay.';
  const decoded = decodeCallData(op.callData);
  if (decoded.kind !== 'execute' && decoded.kind !== 'executeBatch') {
    return `policy: callData ${decoded.selector || '0x'} is not execute or executeBatch.`;
  }
  if (decoded.kind === 'execute' && decoded.operation !== 0) {
    return 'policy: execute operation must be 0. Delegatecall is refused.';
  }
  const calls = decoded.calls || [];
  if (!calls.length) return 'policy: the UserOp has no calls.';
  const recips = new Set();
  let native = 0n;
  const erc = new Map();
  for (const c of calls) {
    native += BigInt(c.value || 0n);
    const h = String(c.data || '').replace(/^0x/i, '');
    const sel = h.slice(0, 8);
    if (
      sel &&
      sel !== TRANSFER_SEL &&
      sel !== APPROVE_SEL &&
      sel !== INCREASE_SEL &&
      sel !== WITHDRAW_SEL &&
      !policy.allow_arbitrary_calls
    ) {
      return `policy: inner selector 0x${sel} is not transfer, approve, increaseAllowance, or withdrawTo. Set allow_arbitrary_calls to permit other calls to an allowlisted contract.`;
    }
    for (const r of innerRecipients(c)) if (r) recips.add(String(r).toLowerCase());
    if ((sel === TRANSFER_SEL || sel === APPROVE_SEL || sel === INCREASE_SEL) && h.length >= 136) {
      const amt = wordAmt(h, 72);
      const tok = String(c.to).toLowerCase();
      erc.set(tok, (erc.get(tok) || 0n) + amt);
    }
    if (sel === WITHDRAW_SEL && h.length >= 136) native += wordAmt(h, 72);
  }
  for (const r of recips) {
    if (!policy.allow_recipients.includes(r)) return `policy: recipient ${r} is not on the allowlist.`;
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
  if (session.unrestricted) {
    const decoded = decodeCallData(op.callData);
    if (decoded.kind === 'execute' && decoded.operation !== 0) return 'session: execute operation must be 0';
    return '';
  }
  const decoded = decodeCallData(op.callData);
  if (decoded.kind !== 'execute' && decoded.kind !== 'executeBatch') {
    return 'session: calldata is not execute or executeBatch';
  }
  if (decoded.kind === 'execute' && decoded.operation !== 0) return 'session: execute operation must be 0';
  const calls = decoded.calls || [];
  if (!calls.length) return 'session: no calls';
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
