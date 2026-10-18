/**
 * Owner ECDSA keystore: encrypted on disk, unlocked in memory with TTL.
 * Passphrase from BLACKSMITH_KEYSTORE_PASS, BLACKSMITH_KEYSTORE_PASS_FILE, or /dev/tty — never a tool arg.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decryptKeystore, encryptKeystore, privateToAddress } from './eth-crypto.mjs';
import { blacksmithHome } from './policy.mjs';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
let mem = null;
let timer = null;

export function keystorePath() {
  return process.env.BLACKSMITH_KEYSTORE || join(blacksmithHome(), 'keystore.json');
}

export function readPassphrase() {
  if (process.env.BLACKSMITH_KEYSTORE_PASS) return process.env.BLACKSMITH_KEYSTORE_PASS;
  const f = process.env.BLACKSMITH_KEYSTORE_PASS_FILE;
  if (f && existsSync(f)) return readFileSync(f, 'utf8').replace(/\n$/, '');
  try {
    if (existsSync('/dev/tty')) {
      writeFileSync('/dev/tty', 'Blacksmith keystore passphrase: ');
      const fd = readFileSync('/dev/tty');
      return String(fd).split('\n')[0] || '';
    }
  } catch {
    /* no tty */
  }
  return '';
}

function wipe() {
  if (mem && mem.priv) mem.priv.fill(0);
  mem = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

function armTtl(ms) {
  if (timer) clearTimeout(timer);
  const ttl = ms ?? (Number(process.env.BLACKSMITH_UNLOCK_TTL_MS) || DEFAULT_TTL_MS);
  mem.until = Date.now() + ttl;
  timer = setTimeout(wipe, ttl);
  if (timer.unref) timer.unref();
}

export function keystoreStatus() {
  const p = keystorePath();
  const onDisk = existsSync(p);
  let address = '';
  if (onDisk) {
    try {
      address = '0x' + JSON.parse(readFileSync(p, 'utf8')).address;
    } catch {
      address = '';
    }
  }
  const unlocked = !!(mem && mem.until > Date.now());
  return {
    path: p,
    onDisk,
    address: unlocked ? mem.address : address,
    unlocked,
    until: unlocked ? mem.until : 0,
  };
}

export function keystoreLock() {
  wipe();
  return 'locked';
}

export function keystoreUnlock(pass) {
  const p = keystorePath();
  if (!existsSync(p)) throw new Error('No keystore on disk. Import with: node mcp/keystore-cli.mjs import');
  const pw = pass || readPassphrase();
  if (!pw) throw new Error('Set BLACKSMITH_KEYSTORE_PASS (or PASS_FILE). Do not pass the passphrase as a tool argument.');
  const json = JSON.parse(readFileSync(p, 'utf8'));
  const privHex = decryptKeystore(json, pw);
  const address = privateToAddress(privHex);
  mem = { priv: Buffer.from(privHex.replace(/^0x/, ''), 'hex'), address, until: 0, pass: pw };
  armTtl();
  return address;
}

export function unlockedOwner() {
  if (!mem || mem.until <= Date.now()) return null;
  return { priv: '0x' + mem.priv.toString('hex'), address: mem.address, pass: mem.pass };
}

export function writeKeystore(privHex, pass, dest) {
  const address = privateToAddress(privHex);
  const json = encryptKeystore(privHex, pass, address);
  const path = dest || keystorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', { mode: 0o600 });
  return { path, address };
}
