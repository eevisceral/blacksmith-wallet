import { createECDH, randomBytes, scryptSync, createCipheriv } from 'node:crypto';
import { keccak256 } from '../onchain-ui/keccak.mjs';

export { keccak256 };

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function strip(h) {
  return String(h || '')
    .replace(/^0x/i, '')
    .toLowerCase();
}

export function hexBuf(h) {
  const s = strip(h);
  if (s.length % 2) throw new Error('odd hex');
  return Buffer.from(s, 'hex');
}

function asKey(priv) {
  const b = Buffer.isBuffer(priv) ? priv : hexBuf(priv);
  if (b.length !== 32) throw new Error('invalid private key');
  const k = BigInt('0x' + b.toString('hex'));
  if (k <= 0n || k >= N) throw new Error('invalid private key');
  return b;
}

export function randomPrivateKeyBytes() {
  for (;;) {
    const b = randomBytes(32);
    const k = BigInt('0x' + b.toString('hex'));
    if (k > 0n && k < N) return b;
    b.fill(0);
  }
}

export function privateToPublic(priv) {
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(asKey(priv));
  return '0x' + ecdh.getPublicKey(null, 'uncompressed').toString('hex');
}

export function publicToAddress(pub) {
  const p = strip(pub);
  const body = p.startsWith('04') ? p.slice(2) : p;
  return '0x' + strip(keccak256('0x' + body)).slice(-40);
}

export function privateToAddress(priv) {
  return publicToAddress(privateToPublic(priv));
}

export function eip712Hash(domainSeparator, structHash) {
  return keccak256(Buffer.concat([Buffer.from([0x19, 0x01]), hexBuf(domainSeparator), hexBuf(structHash)]));
}


const SCRYPT_N = 262144;
const SCRYPT_MAXMEM = 1024 * 1024 * 1024;

function scryptKey(password, salt, n) {
  return scryptSync(password, salt, 32, { N: n, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
}

/** Web3 secret-storage V3. scrypt N=262144, the geth standard. aes-128-ctr is Node's OpenSSL. */
export function encryptKeystore(priv, password, address) {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const kdfparams = { dklen: 32, n: SCRYPT_N, r: 8, p: 1, salt: salt.toString('hex') };
  const derived = scryptKey(password, salt, SCRYPT_N);
  const cipher = createCipheriv('aes-128-ctr', derived.subarray(0, 16), iv);
  const ct = Buffer.concat([cipher.update(asKey(priv)), cipher.final()]);
  const mac = strip(keccak256(Buffer.concat([derived.subarray(16, 32), ct])));
  derived.fill(0);
  return {
    version: 3,
    id: randomBytes(16).toString('hex'),
    address: strip(address || privateToAddress(priv)),
    crypto: {
      ciphertext: ct.toString('hex'),
      cipherparams: { iv: iv.toString('hex') },
      cipher: 'aes-128-ctr',
      kdf: 'scrypt',
      kdfparams,
      mac,
    },
  };
}


