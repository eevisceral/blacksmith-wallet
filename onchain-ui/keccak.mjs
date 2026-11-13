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

function hexToBytes(h) {
  const s = String(h || '')
    .replace(/^0x/i, '')
    .toLowerCase();
  if (s.length % 2) throw new Error('odd hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string' && /^0x[0-9a-f]*$/i.test(data)) return hexToBytes(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new Error('keccak input must be bytes or a hex string');
}

/** keccak-256 (not NIST SHA3). Uint8Array in, hex out. Safe to bundle in the page. */
export function keccak256(data) {
  const msg = toBytes(data);
  const rate = 136;
  let pad = rate - (msg.length % rate);
  if (pad === 0) pad = rate;
  const buf = new Uint8Array(msg.length + pad);
  buf.set(msg);
  buf[msg.length] ^= 0x01;
  buf[buf.length - 1] ^= 0x80;
  const st = new BigUint64Array(25);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let off = 0; off < buf.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) st[i] ^= view.getBigUint64(off + i * 8, true);
    keccakF(st);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) ov.setBigUint64(i * 8, st[i], true);
  let hex = '';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
  return '0x' + hex;
}
