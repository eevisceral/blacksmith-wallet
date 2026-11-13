import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function assertStrongKeystore(keystorePath) {
  let j;
  try {
    j = JSON.parse(readFileSync(keystorePath, 'utf8'));
  } catch {
    throw new Error('keystore is not valid JSON.');
  }
  const crypto = j.crypto || {};
  const p = crypto.kdfparams || {};
  if (crypto.kdf !== 'scrypt' || crypto.cipher !== 'aes-128-ctr') {
    throw new Error('keystore must be scrypt + aes-128-ctr');
  }
  if (Number(p.n) !== 262144 || Number(p.r) !== 8 || Number(p.p) !== 1 || Number(p.dklen) !== 32) {
    throw new Error('keystore scrypt must be N=262144, r=8, p=1. Re-import the key. Foundry cast wallet new uses N=8192, which this wallet refuses.');
  }
  return j;
}

// Not configuration. These are stripped so a shell or Foundry leftover cannot reach cast.
const dropFromCast = [
  'BLACKSMITH_KEYSTORE_PASS',
  'BLACKSMITH_IMPORT_KEY',
  'CAST_PASSWORD',
  'CAST_UNSAFE_PASSWORD',
  'ETH_PASSWORD',
  'ETH_PRIVATE_KEY',
  'FOUNDRY_ETH_PRIVATE_KEY',
  'PRIVATE_KEY',
  'MNEMONIC',
];

function castEnv() {
  const env = { ...process.env };
  for (const k of dropFromCast) delete env[k];
  return env;
}

function cast(args) {
  const r = spawnSync('cast', args, { encoding: 'utf8', env: castEnv() });
  if (r.error) {
    if (r.error.code === 'ENOENT') {
      throw new Error('Signing needs Foundry cast on PATH. cast decrypts the keystore. This process does not.');
    }
    throw r.error;
  }
  if (r.status !== 0) {
    const msg = String(r.stderr || r.stdout || 'cast failed').trim();
    throw new Error(msg);
  }
  return String(r.stdout || '').trim();
}

export function castKeyAddress(keystorePath, passwordFile) {
  const j = assertStrongKeystore(keystorePath);
  const out = cast(['wallet', 'address', '--keystore', keystorePath, '--password-file', passwordFile]);
  const m = out.match(/0x[0-9a-fA-F]{40}/);
  if (!m) throw new Error('cast wallet address returned no address');
  const fileAddr = String(j.address || '').replace(/^0x/i, '').toLowerCase();
  if (fileAddr !== m[0].slice(2).toLowerCase()) throw new Error('keystore address does not match the key');
  return m[0];
}

export function castSign(keystorePath, passwordFile, hash32, { personal }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash32 || ''))) throw new Error('cast signs a 32-byte hash.');
  assertStrongKeystore(keystorePath);
  const args = ['wallet', 'sign', '--keystore', keystorePath, '--password-file', passwordFile];
  if (!personal) args.push('--no-hash');
  args.push(hash32);
  const out = cast(args);
  const m = out.match(/0x[0-9a-fA-F]{130}/);
  if (!m) throw new Error('cast wallet sign returned no signature');
  return m[0];
}

export function castMktx(keystorePath, passwordFile, tx) {
  assertStrongKeystore(keystorePath);
  const args = [
    'mktx',
    '--keystore',
    keystorePath,
    '--password-file',
    passwordFile,
    '--chain',
    String(tx.chainId),
    '--nonce',
    String(tx.nonce),
    '--gas-limit',
    String(tx.gas),
    '--priority-gas-price',
    String(tx.maxPriorityFeePerGas),
    '--gas-price',
    String(tx.maxFeePerGas),
    '--value',
    String(tx.value || 0n),
    tx.to,
  ];
  const data = String(tx.data || '0x');
  if (data !== '0x') args.push(data);
  const out = cast(args);
  const m = out.match(/0x[0-9a-fA-F]+/);
  if (!m || m[0].length < 10) throw new Error('cast mktx returned no raw transaction');
  return m[0];
}
