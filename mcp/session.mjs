/**
 * Local session-key material (Kernel v2 SessionKeyValidator, EntryPoint v0.6).
 * Private keys never leave this module except to sign.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  decryptKeystore,
  encryptKeystore,
  privateToAddress,
  randomPrivateKey,
} from './eth-crypto.mjs';
import { blacksmithHome } from './policy.mjs';
import { unlockedOwner } from './keystore.mjs';

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
  const owner = unlockedOwner();
  const pass = opts.pass || (owner && owner.pass) || process.env.BLACKSMITH_KEYSTORE_PASS;
  if (!pass) throw new Error('Unlock the owner keystore first (same passphrase encrypts the session key), or set BLACKSMITH_KEYSTORE_PASS.');
  const priv = randomPrivateKey();
  const address = privateToAddress(priv);
  const keystore = encryptKeystore(priv, pass, address);
  const rec = {
    keystore,
    unrestricted: opts.unrestricted !== false && !(opts.targets && opts.targets.length),
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
  const owner = unlockedOwner();
  const pass = (owner && owner.pass) || process.env.BLACKSMITH_KEYSTORE_PASS;
  if (!pass) throw new Error('Unlock the owner keystore or set BLACKSMITH_KEYSTORE_PASS to decrypt session keys.');
  const want = address ? String(address).toLowerCase() : '';
  const doc = loadDisk();
  const rec = (doc.keys || []).find((k) => !want || ('0x' + k.keystore.address).toLowerCase() === want);
  if (!rec) throw new Error('No session key on disk. session_create first.');
  const priv = decryptKeystore(rec.keystore, pass);
  sessionMem = {
    priv,
    address: privateToAddress(priv),
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
  return sessionMem;
}

export function sessionRevokeLocal(address) {
  const doc = loadDisk();
  const want = String(address).toLowerCase().replace(/^0x/, '');
  doc.keys = (doc.keys || []).filter((k) => k.keystore.address !== want);
  saveDisk(doc);
  if (sessionMem && sessionMem.address.replace(/^0x/, '').toLowerCase() === want) sessionMem = null;
}

export function sessionLock() {
  sessionMem = null;
}
