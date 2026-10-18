/**
 * keccak-256 + secp256k1 ECDSA + EIP-1559 raw tx. Zero npm deps (Node crypto HMAC/scrypt/ECDH only).
 */
import { createECDH, createHmac, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const A = 0n;

function strip(h) {
  return String(h || '')
    .replace(/^0x/i, '')
    .toLowerCase();
}

export function toHex(b) {
  return '0x' + Buffer.from(b).toString('hex');
}

export function hexBuf(h) {
  const s = strip(h);
  if (s.length % 2) throw new Error('odd hex');
  return Buffer.from(s, 'hex');
}

const MASK64 = 0xffffffffffffffffn;
function rotl64(x, n) {
  const s = Number(n) % 64;
  if (!s) return x & MASK64;
  return ((x << BigInt(s)) | (x >> BigInt(64 - s))) & MASK64;
}

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_RHO = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function keccakF(st) {
  for (let round = 0; round < 24; round++) {
    const c = new BigUint64Array(5);
    for (let x = 0; x < 5; x++) c[x] = st[x] ^ st[x + 5] ^ st[x + 10] ^ st[x + 15] ^ st[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) st[x + 5 * y] ^= d;
    }
    const b = new BigUint64Array(25);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const nx = y;
        const ny = (2 * x + 3 * y) % 5;
        b[nx + 5 * ny] = rotl64(st[x + 5 * y], KECCAK_RHO[x + 5 * y]);
      }
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        st[x + 5 * y] =
          (b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y]) & MASK64 & b[((x + 2) % 5) + 5 * y])) & MASK64;
      }
    }
    st[0] ^= KECCAK_RC[round];
  }
}

/** keccak-256 (not NIST SHA3). */
export function keccak256(data) {
  const msg = Buffer.isBuffer(data)
    ? data
    : typeof data === 'string' && /^0x[0-9a-f]*$/i.test(data)
      ? hexBuf(data)
      : Buffer.from(data);
  const st = new BigUint64Array(25);
  const rate = 136;
  let pad = rate - (msg.length % rate);
  if (pad === 0) pad = rate;
  const buf = Buffer.concat([msg, Buffer.alloc(pad)]);
  buf[msg.length] ^= 0x01;
  buf[buf.length - 1] ^= 0x80;
  for (let off = 0; off < buf.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) st[i] ^= buf.readBigUInt64LE(off + i * 8);
    keccakF(st);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(st[i], i * 8);
  return '0x' + out.toString('hex');
}

function modP(x) {
  x %= P;
  return x < 0n ? x + P : x;
}

function invP(a) {
  return modPow(modP(a), P - 2n, P);
}

function modPow(b, e, m) {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function toAffine(X, Y, Z) {
  if (Z === 0n) return { inf: true };
  const zinv = invP(Z);
  const z2 = modP(zinv * zinv);
  return { inf: false, x: modP(X * z2), y: modP(Y * z2 * zinv) };
}

function jAdd(p, q) {
  if (p.Z === 0n) return q;
  if (q.Z === 0n) return p;
  const z1z1 = modP(p.Z * p.Z);
  const z2z2 = modP(q.Z * q.Z);
  const u1 = modP(p.X * z2z2);
  const u2 = modP(q.X * z1z1);
  const s1 = modP(p.Y * q.Z * z2z2);
  const s2 = modP(q.Y * p.Z * z1z1);
  const h = modP(u2 - u1);
  const r = modP(s2 - s1);
  if (h === 0n) {
    if (r === 0n) return jDbl(p);
    return { X: 0n, Y: 1n, Z: 0n };
  }
  const hh = modP(h * h);
  const hhh = modP(h * hh);
  const v = modP(u1 * hh);
  const X3 = modP(r * r - hhh - 2n * v);
  const Y3 = modP(r * (v - X3) - s1 * hhh);
  const Z3 = modP(p.Z * q.Z * h);
  return { X: X3, Y: Y3, Z: Z3 };
}

function jDbl(p) {
  if (p.Z === 0n || p.Y === 0n) return { X: 0n, Y: 1n, Z: 0n };
  const xx = modP(p.X * p.X);
  const yy = modP(p.Y * p.Y);
  const yyyy = modP(yy * yy);
  const zz = modP(p.Z * p.Z);
  const s = modP(2n * ((modP(p.X + yy) * modP(p.X + yy) - xx - yyyy)));
  const m = modP(3n * xx + A * modP(zz * zz));
  const X3 = modP(m * m - 2n * s);
  const Y3 = modP(m * (s - X3) - 8n * yyyy);
  const Z3 = modP(2n * p.Y * p.Z);
  return { X: X3, Y: Y3, Z: Z3 };
}

function jMul(k, base) {
  let r = { X: 0n, Y: 1n, Z: 0n };
  let p = base;
  let n = k;
  while (n > 0n) {
    if (n & 1n) r = jAdd(r, p);
    p = jDbl(p);
    n >>= 1n;
  }
  return r;
}

function pointG() {
  return { X: GX, Y: GY, Z: 1n };
}

export function randomPrivateKey() {
  for (;;) {
    const b = randomBytes(32);
    const k = BigInt('0x' + b.toString('hex'));
    if (k > 0n && k < N) return '0x' + b.toString('hex');
  }
}

export function privateToPublic(priv) {
  const k = BigInt('0x' + strip(priv));
  if (k <= 0n || k >= N) throw new Error('invalid private key');
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(hexBuf(priv));
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

function bits2int(b, qlen) {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  const blen = BigInt(b.length * 8);
  if (blen > qlen) v >>= blen - qlen;
  return v;
}

function bits2octets(b) {
  let z = bits2int(b, 256n) % N;
  const hex = z.toString(16).padStart(64, '0');
  return Buffer.from(hex, 'hex');
}

function hmac(k, ...m) {
  return createHmac('sha256', k)
    .update(Buffer.concat(m))
    .digest();
}

function rfc6979(priv, hash32) {
  const x = hexBuf(priv);
  const h1 = hexBuf(hash32);
  let v = Buffer.alloc(32, 0x01);
  let k = Buffer.alloc(32, 0x00);
  k = hmac(k, v, Buffer.from([0x00]), x, h1);
  v = hmac(k, v);
  k = hmac(k, v, Buffer.from([0x01]), x, h1);
  v = hmac(k, v);
  for (;;) {
    v = hmac(k, v);
    const t = bits2int(v, 256n);
    if (t > 0n && t < N) return t;
    k = hmac(k, v, Buffer.from([0x00]));
    v = hmac(k, v);
  }
}

function toEthSig(r, s, recId) {
  if (s > N / 2n) {
    s = N - s;
    recId ^= 1;
  }
  return (
    '0x' +
    r.toString(16).padStart(64, '0') +
    s.toString(16).padStart(64, '0') +
    (recId + 27).toString(16).padStart(2, '0')
  );
}

function recIdFor(priv, r, s, z) {
  const pub = strip(privateToPublic(priv)).slice(2);
  for (let i = 0; i < 2; i++) {
    const R = recoverPoint(r, s, z, i);
    if (!R) continue;
    const a = toAffine(R.X, R.Y, R.Z);
    if (a.inf) continue;
    const enc = a.x.toString(16).padStart(64, '0') + a.y.toString(16).padStart(64, '0');
    if (enc === pub) return i;
  }
  return 0;
}

function recoverPoint(r, s, z, recId) {
  const x = r + BigInt(recId >> 1) * N;
  if (x >= P) return null;
  const y2 = modP(modPow(x, 3n, P) + 7n);
  let y = modPow(y2, (P + 1n) / 4n, P);
  if ((y & 1n) !== BigInt(recId & 1)) y = P - y;
  const R = { X: x, Y: y, Z: 1n };
  const rinv = modPow(r, N - 2n, N);
  const u1 = modPNneg((N - (z % N)) * rinv);
  const u2 = (s * rinv) % N;
  return jAdd(jMul(u1, pointG()), jMul(u2, R));
}

function modPNneg(x) {
  x %= N;
  return x < 0n ? x + N : x;
}

export function signHash(priv, hash32) {
  const z = BigInt('0x' + strip(hash32));
  const d = BigInt('0x' + strip(priv));
  let r = 0n;
  let s = 0n;
  let k = rfc6979(priv, hash32);
  for (let i = 0; i < 8 && (r === 0n || s === 0n); i++) {
    if (i) k = (k + 1n) % N || 1n;
    const j = jMul(k, pointG());
    const p = toAffine(j.X, j.Y, j.Z);
    if (p.inf) continue;
    r = p.x % N;
    const kinv = modPow(k, N - 2n, N);
    s = (kinv * (z + r * d)) % N;
  }
  if (!r || !s) throw new Error('sign failed');
  if (s > N / 2n) s = N - s;
  const addr = privateToAddress(priv);
  for (const rec of [0, 1]) {
    const sig =
      '0x' +
      r.toString(16).padStart(64, '0') +
      s.toString(16).padStart(64, '0') +
      (rec + 27).toString(16).padStart(2, '0');
    try {
      if (strip(recoverAddress(hash32, sig)) === strip(addr)) return sig;
    } catch {
      /* try other rec */
    }
  }
  throw new Error('could not assign recovery id');
}

export function personalSignHash(hash32) {
  const inner = hexBuf(hash32);
  if (inner.length !== 32) throw new Error('hash must be 32 bytes');
  const prefix = Buffer.from('\x19Ethereum Signed Message:\n32', 'utf8');
  return keccak256(Buffer.concat([prefix, inner]));
}

export function personalSign(priv, hash32) {
  return signHash(priv, personalSignHash(hash32));
}

export function recoverAddress(hash32, sig) {
  const h = strip(sig);
  const r = BigInt('0x' + h.slice(0, 64));
  const s = BigInt('0x' + h.slice(64, 128));
  let v = parseInt(h.slice(128, 130), 16);
  if (v >= 27) v -= 27;
  const z = BigInt('0x' + strip(hash32));
  const R = recoverPoint(r, s, z, v);
  if (!R) throw new Error('recover failed');
  const a = toAffine(R.X, R.Y, R.Z);
  const enc = '04' + a.x.toString(16).padStart(64, '0') + a.y.toString(16).padStart(64, '0');
  return publicToAddress('0x' + enc);
}

export function eip712Hash(domainSeparator, structHash) {
  return keccak256(Buffer.concat([Buffer.from([0x19, 0x01]), hexBuf(domainSeparator), hexBuf(structHash)]));
}

function rlpLen(len, offset) {
  if (len <= 55) return Buffer.from([offset + len]);
  const hex = len.toString(16);
  const l = hex.length % 2 ? '0' + hex : hex;
  const lb = Buffer.from(l, 'hex');
  return Buffer.concat([Buffer.from([offset + 55 + lb.length]), lb]);
}

function rlpItem(b) {
  if (b.length === 1 && b[0] < 0x80) return b;
  return Buffer.concat([rlpLen(b.length, 0x80), b]);
}

function rlpList(items) {
  const body = Buffer.concat(items.map(rlpItem));
  return Buffer.concat([rlpLen(body.length, 0xc0), body]);
}

function intBuf(n) {
  if (n === 0n) return Buffer.alloc(0);
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  return Buffer.from(h, 'hex');
}

export function signLegacyTx(priv, { nonce, gasPrice, gas, to, value = 0n, data = '0x', chainId }) {
  const fields = [intBuf(BigInt(nonce)), intBuf(BigInt(gasPrice)), intBuf(BigInt(gas)), hexBuf(to), intBuf(BigInt(value)), hexBuf(data || '0x')];
  const unsigned = rlpList([...fields, intBuf(BigInt(chainId)), Buffer.alloc(0), Buffer.alloc(0)]);
  const hash = keccak256(unsigned);
  const sig = signHash(priv, hash);
  const r = BigInt('0x' + strip(sig).slice(0, 64));
  const s = BigInt('0x' + strip(sig).slice(64, 128));
  const rec = parseInt(strip(sig).slice(128, 130), 16) - 27;
  const v = BigInt(chainId) * 2n + 35n + BigInt(rec);
  const raw = rlpList([...fields, intBuf(v), intBuf(r), intBuf(s)]);
  return { raw: toHex(raw), hash: keccak256(raw) };
}

export function signEip1559Tx(priv, tx) {
  const access = rlpList([]);
  const pre = [
    intBuf(BigInt(tx.chainId)),
    intBuf(BigInt(tx.nonce)),
    intBuf(BigInt(tx.maxPriorityFeePerGas)),
    intBuf(BigInt(tx.maxFeePerGas)),
    intBuf(BigInt(tx.gas)),
    hexBuf(tx.to),
    intBuf(BigInt(tx.value || 0n)),
    hexBuf(tx.data || '0x'),
    access,
  ];
  const unsigned = Buffer.concat([Buffer.from([0x02]), rlpList(pre)]);
  const hash = keccak256(unsigned);
  const sig = signHash(priv, hash);
  const r = BigInt('0x' + strip(sig).slice(0, 64));
  const s = BigInt('0x' + strip(sig).slice(64, 128));
  const yParity = parseInt(strip(sig).slice(128, 130), 16) - 27;
  const rawBody = rlpList([...pre, intBuf(BigInt(yParity)), intBuf(r), intBuf(s)]);
  const raw = Buffer.concat([Buffer.from([0x02]), rawBody]);
  return { raw: toHex(raw), hash: keccak256(raw) };
}

/** Web3 secret-storage V3 (scrypt + aes-128-ctr). */
export function encryptKeystore(priv, password, address) {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const kdfparams = { dklen: 32, n: 16384, r: 8, p: 1, salt: salt.toString('hex') };
  const derived = scryptSync(password, salt, 32, { N: kdfparams.n, r: kdfparams.r, p: kdfparams.p, maxmem: 256 * 1024 * 1024 });
  const cipher = createCipheriv('aes-128-ctr', derived.subarray(0, 16), iv);
  const ct = Buffer.concat([cipher.update(hexBuf(priv)), cipher.final()]);
  const mac = strip(keccak256(Buffer.concat([derived.subarray(16, 32), ct])));
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

export function decryptKeystore(json, password) {
  const k = typeof json === 'string' ? JSON.parse(json) : json;
  const { kdfparams, ciphertext, cipherparams, mac } = {
    kdfparams: k.crypto.kdfparams,
    ciphertext: k.crypto.ciphertext,
    cipherparams: k.crypto.cipherparams,
    mac: k.crypto.mac,
  };
  if (k.crypto.kdf !== 'scrypt') throw new Error('keystore kdf must be scrypt');
  const salt = Buffer.from(kdfparams.salt, 'hex');
  const derived = scryptSync(password, salt, kdfparams.dklen || 32, {
    N: kdfparams.n,
    r: kdfparams.r,
    p: kdfparams.p,
    maxmem: 256 * 1024 * 1024,
  });
  const ct = Buffer.from(ciphertext, 'hex');
  const got = strip(keccak256(Buffer.concat([derived.subarray(16, 32), ct])));
  if (got !== strip(mac)) throw new Error('wrong keystore passphrase');
  const dec = createDecipheriv('aes-128-ctr', derived.subarray(0, 16), Buffer.from(cipherparams.iv, 'hex'));
  const priv = Buffer.concat([dec.update(ct), dec.final()]);
  return '0x' + priv.toString('hex');
}

void bits2octets;
