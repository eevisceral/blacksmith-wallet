#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { readPassphrase, writeKeystore, keystorePath } from './keystore.mjs';
import { randomPrivateKeyBytes } from './eth-crypto.mjs';

const cmd = process.argv[2] || '';
const pass = readPassphrase({ interactive: true });
if (!pass) {
  console.error('Set BLACKSMITH_KEYSTORE_PASS_FILE (mode 0600).');
  process.exit(1);
}
if (cmd === 'generate') {
  const raw = randomPrivateKeyBytes();
  let r;
  try {
    r = writeKeystore(raw, pass);
  } finally {
    raw.fill(0);
  }
  console.log('wrote', r.path);
  console.log('address', r.address);
  process.exit(0);
}
if (cmd === 'import') {
  const file = process.env.BLACKSMITH_IMPORT_KEY_FILE;
  const key = String(file ? readFileSync(file, 'utf8') : process.env.BLACKSMITH_IMPORT_KEY || '').trim();
  if (!file && process.env.BLACKSMITH_IMPORT_KEY) {
    console.error('BLACKSMITH_IMPORT_KEY stays in the parent environment. Prefer BLACKSMITH_IMPORT_KEY_FILE mode 0600, then delete that file.');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error('Set BLACKSMITH_IMPORT_KEY_FILE to a mode-0600 file containing a 32-byte hex private key.');
    process.exit(1);
  }
  const raw = Buffer.from(key.slice(2), 'hex');
  let r;
  try {
    r = writeKeystore(raw, pass);
  } finally {
    raw.fill(0);
  }
  console.log('wrote', r.path);
  console.log('address', r.address);
  process.exit(0);
}
if (cmd === 'path') {
  writeFileSync(1, keystorePath() + '\n');
  process.exit(0);
}
console.error('Usage: generate | import | path');
process.exit(1);
