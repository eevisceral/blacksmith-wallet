import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync, closeSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { castKeyAddress } from './cast-sign.mjs';
import { encryptKeystore, privateToAddress } from './eth-crypto.mjs';
import { blacksmithHome } from './policy.mjs';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
let mem = null;
let timer = null;

export function keystorePath() {
  return process.env.BLACKSMITH_KEYSTORE || join(blacksmithHome(), 'keystore.json');
}

function modeAllowsOthers(path) {
  return (statSync(path).mode & 0o077) !== 0;
}

function keychainPass() {
  if (process.platform !== 'darwin') return '';
  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', 'blacksmith-v1-keystore', '-a', 'owner', '-w'],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return '';
  return String(r.stdout || '').replace(/\n$/, '');
}

function readTtyPassphrase() {
  let fd;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return '';
  }
  const echo = (on) => {
    try {
      spawnSync('stty', [on ? 'echo' : '-echo'], { stdio: [fd, fd, 'ignore'] });
    } catch {
    }
  };
  try {
    writeSync(fd, 'Blacksmith keystore passphrase: ');
    echo(false);
    const buf = Buffer.alloc(256);
    let s = '';
    while (!s.includes('\n') && s.length < 1024) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      s += buf.subarray(0, n).toString('utf8');
    }
    writeSync(fd, '\n');
    return s.split('\n')[0] || '';
  } catch {
    return '';
  } finally {
    echo(true);
    try {
      closeSync(fd);
    } catch {
    }
  }
}

export function readPassphrase(opts = {}) {
  const f = process.env.BLACKSMITH_KEYSTORE_PASS_FILE;
  if (f && existsSync(f)) {
    if (modeAllowsOthers(f)) throw new Error('BLACKSMITH_KEYSTORE_PASS_FILE must be mode 0600.');
    return readFileSync(f, 'utf8').replace(/\n$/, '');
  }
  const chained = keychainPass();
  if (chained) return chained;
  if (opts.interactive) return readTtyPassphrase();
  return '';
}

export function withPasswordFile(fn, explicit) {
  if (!explicit && process.env.BLACKSMITH_KEYSTORE_PASS_FILE) {
    const f = process.env.BLACKSMITH_KEYSTORE_PASS_FILE;
    if (!existsSync(f)) throw new Error('BLACKSMITH_KEYSTORE_PASS_FILE does not exist.');
    if (modeAllowsOthers(f)) throw new Error('BLACKSMITH_KEYSTORE_PASS_FILE must be mode 0600.');
    return fn(f);
  }
  const pw = explicit || readPassphrase();
  if (!pw) throw new Error('Set BLACKSMITH_KEYSTORE_PASS_FILE (mode 0600), or on a Mac store it in the login keychain as blacksmith-v1-keystore / owner.');
  const dir = mkdtempSync(join(tmpdir(), 'bs-pw-'));
  const file = join(dir, 'pw');
  writeFileSync(file, pw, { mode: 0o600 });
  chmodSync(file, 0o600);
  try {
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function tightenFile(path) {
  chmodSync(path, 0o600);
  const dir = dirname(path);
  if (dir === blacksmithHome() && dir !== homedir()) chmodSync(dir, 0o700);
}

function wipe() {
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
  if (modeAllowsOthers(p)) throw new Error(`Keystore ${p} is readable by the group or others. chmod 600 it.`);
  const pw = pass || readPassphrase();
  if (!pw) throw new Error('Set BLACKSMITH_KEYSTORE_PASS_FILE (mode 0600). Do not put the passphrase in the environment or in a tool argument.');
  const address = withPasswordFile((file) => castKeyAddress(p, file), pass || undefined);
  mem = { address, until: 0 };
  armTtl();
  return address;
}

export function unlockedOwner() {
  if (!mem || mem.until <= Date.now()) return null;
  return { address: mem.address };
}

export function requireUnlockedOwner() {
  if (!mem || mem.until <= Date.now()) throw new Error('Unlock the owner keystore before signing.');
  return mem.address;
}

export function writeKeystore(privHex, pass, dest) {
  const address = privateToAddress(privHex);
  const json = encryptKeystore(privHex, pass, address);
  const path = dest || keystorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', { mode: 0o600 });
  tightenFile(path);
  try {
    const back = withPasswordFile((file) => castKeyAddress(path, file), pass);
    if (back.toLowerCase() !== address.toLowerCase()) throw new Error('address');
  } catch (e) {
    try {
      unlinkSync(path);
    } catch {
    }
    throw new Error('keystore failed the decrypt check after write. ' + (e.message || e));
  }
  return { path, address };
}
