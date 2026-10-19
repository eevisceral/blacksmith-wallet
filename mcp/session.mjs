import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encryptKeystore, privateToAddress, randomPrivateKeyBytes } from './eth-crypto.mjs';
import { blacksmithHome, loadPolicy } from './policy.mjs';
import { castKeyAddress } from './cast-sign.mjs';
import { readPassphrase, withPasswordFile } from './keystore.mjs';

let sessionMem = null;

export function sessionsPath() {
  return process.env.BLACKSMITH_SESSIONS || join(blacksmithHome(), 'sessions.json');
}

function loadDisk() {
  const p = sessionsPath();
  if (!existsSync(p)) return { keys: [] };
  return JSON.parse(readFileSync(p, 'utf8'));
}

function saveDisk(doc) {
  const p = sessionsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  chmodSync(p, 0o600);
}

export function sessionStatus() {
  const doc = loadDisk();
  const unlocked = !!(sessionMem && sessionMem.until > Date.now());
  return {
    path: sessionsPath(),
    count: (doc.keys || []).length,
    unlocked,
    active: unlocked
      ? { address: sessionMem.address, unrestricted: sessionMem.unrestricted, validUntil: sessionMem.validUntil }
      : (doc.keys || []).map((k) => ({ address: '0x' + k.keystore.address, validUntil: k.validUntil, unrestricted: k.unrestricted })),
  };
}

export function sessionCreate(opts = {}) {
  const pass = opts.pass || readPassphrase();
  if (!pass) throw new Error('Set BLACKSMITH_KEYSTORE_PASS_FILE (mode 0600).');
  if (opts.unrestricted === true && !loadPolicy().allow_unrestricted_session) {
    throw new Error('An unrestricted session key is owner-equivalent on chain. Set allow_unrestricted_session true in policy.json to create one.');
  }
  const raw = randomPrivateKeyBytes();
  let address;
  let keystore;
  try {
    address = privateToAddress(raw);
    keystore = encryptKeystore(raw, pass, address);
  } finally {
    raw.fill(0);
  }
  const hasTargets = Array.isArray(opts.targets) && opts.targets.length > 0;
  if (opts.unrestricted !== true && !hasTargets) {
    throw new Error('Pass targets for a limited session, or unrestricted: true for an owner-equivalent session key.');
  }
  if (opts.unrestricted !== true && !(Array.isArray(opts.selectors) && opts.selectors.length)) {
    throw new Error('A limited session needs selectors. Empty calldata cannot pass the on-chain permission check.');
  }
  const rec = {
    keystore,
    unrestricted: opts.unrestricted === true,
    targets: opts.targets || [],
    selectors: opts.selectors || [],
    valueLimit: opts.valueLimit != null ? String(opts.valueLimit) : null,
    validAfter: opts.validAfter || 0,
    validUntil: opts.validUntil || 0xfffffffffffe,
    created: Date.now(),
  };
  const doc = loadDisk();
  doc.keys = doc.keys || [];
  doc.keys.push(rec);
  saveDisk(doc);
  return { address, unrestricted: rec.unrestricted, validUntil: rec.validUntil };
}

export function sessionUnlock(address) {
  if (!readPassphrase()) throw new Error('Set BLACKSMITH_KEYSTORE_PASS_FILE (mode 0600) to decrypt session keys.');
  const want = address ? String(address).toLowerCase() : '';
  const doc = loadDisk();
  const rec = (doc.keys || []).find((k) => !want || ('0x' + k.keystore.address).toLowerCase() === want);
  if (!rec) throw new Error('No session key on disk. session_create first.');
  const seen = withSessionFile(rec, (file, pw) => castKeyAddress(file, pw));
  sessionMem = {
    address: seen,
    unrestricted: rec.unrestricted,
    targets: rec.targets,
    selectors: rec.selectors,
    valueLimit: rec.valueLimit,
    validAfter: rec.validAfter,
    validUntil: rec.validUntil,
    until: Date.now() + (Number(process.env.BLACKSMITH_UNLOCK_TTL_MS) || 15 * 60 * 1000),
  };
  return sessionMem.address;
}

export function unlockedSession() {
  if (!sessionMem || sessionMem.until <= Date.now()) return null;
  return {
    address: sessionMem.address,
    unrestricted: sessionMem.unrestricted,
    targets: sessionMem.targets,
    selectors: sessionMem.selectors,
    valueLimit: sessionMem.valueLimit,
    validAfter: sessionMem.validAfter,
    validUntil: sessionMem.validUntil,
  };
}

function withSessionFile(rec, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'bs-sess-'));
  const file = join(dir, 'key.json');
  writeFileSync(file, JSON.stringify(rec.keystore) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  try {
    return withPasswordFile((pw) => fn(file, pw));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function withUnlockedSession(fn) {
  if (!sessionMem || sessionMem.until <= Date.now()) throw new Error('Unlock a session key before signing.');
  const doc = loadDisk();
  const want = sessionMem.address.toLowerCase();
  const rec = (doc.keys || []).find((k) => ('0x' + k.keystore.address).toLowerCase() === want);
  if (!rec) throw new Error('Unlocked session key is no longer on disk.');
  return withSessionFile(rec, fn);
}

export function sessionRevokeLocal(address) {
  const doc = loadDisk();
  const want = String(address).toLowerCase().replace(/^0x/, '');
  doc.keys = (doc.keys || []).filter((k) => k.keystore.address !== want);
  saveDisk(doc);
  if (sessionMem && sessionMem.address.replace(/^0x/, '').toLowerCase() === want) sessionLock();
}

export function sessionLock() {
  sessionMem = null;
}
