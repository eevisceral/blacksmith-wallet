#!/usr/bin/env node
/**
 * Import or generate the owner ECDSA keystore. Never prints the private key.
 *   BLACKSMITH_KEYSTORE_PASS=… node mcp/keystore-cli.mjs generate
 *   BLACKSMITH_KEYSTORE_PASS=… BLACKSMITH_IMPORT_KEY=0x… node mcp/keystore-cli.mjs import
 */
import { writeFileSync } from 'node:fs';
import { readPassphrase, writeKeystore, keystorePath } from './keystore.mjs';
import { randomPrivateKey } from './eth-crypto.mjs';

const cmd = process.argv[2] || '';
const pass = readPassphrase();
if (!pass) {
  console.error('Set BLACKSMITH_KEYSTORE_PASS.');
  process.exit(1);
}
if (cmd === 'generate') {
  const r = writeKeystore(randomPrivateKey(), pass);
  console.log('wrote', r.path);
  console.log('address', r.address);
  process.exit(0);
}
if (cmd === 'import') {
  const key = String(process.env.BLACKSMITH_IMPORT_KEY || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error('Set BLACKSMITH_IMPORT_KEY to a 32-byte hex private key.');
    process.exit(1);
  }
  const r = writeKeystore(key, pass);
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
