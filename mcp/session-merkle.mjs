/**
 * SessionKeyValidator permission leaf. Encoding locked by SessionLeaf.t.sol.
 * One leaf uses an empty merkle proof (root == leaf). Several leaves use a sorted pair tree.
 */
import { keccak256 } from './eth-crypto.mjs';

function word(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

function addrWord(a) {
  return String(a).replace(/^0x/i, '').toLowerCase().padStart(64, '0');
}

function selWord(sig) {
  return String(sig).replace(/^0x/i, '').toLowerCase().padEnd(8, '0').slice(0, 8).padEnd(64, '0');
}

export function encodePermission({ index, target, sig, valueLimit }) {
  const body = [
    word(index),
    addrWord(target),
    selWord(sig),
    word(valueLimit),
    word(0x120),
    word(0),
    word(0),
    word(0),
    word(0),
    word(0),
  ].join('');
  return '0x' + word(0x20) + body;
}

function keccakHex(hex) {
  const raw = keccak256(Buffer.from(hex.replace(/^0x/i, ''), 'hex'));
  const h = Buffer.isBuffer(raw) ? raw.toString('hex') : String(raw).replace(/^0x/i, '');
  return '0x' + h;
}

export function permissionLeaf(perm) {
  return keccakHex(encodePermission(perm));
}

function pair(a, b) {
  const left = BigInt(a) < BigInt(b) ? a : b;
  const right = BigInt(a) < BigInt(b) ? b : a;
  return keccakHex(left.replace(/^0x/i, '') + right.replace(/^0x/i, ''));
}

export function merkle(leaves) {
  if (!leaves.length) throw new Error('A limited session needs at least one permission.');
  if (leaves.length === 1) return { root: leaves[0], proofs: [[]] };
  let level = leaves.slice();
  const proof = leaves.map(() => []);
  let idx = leaves.map((_, i) => i);
  while (level.length > 1) {
    const next = [];
    const nextIdx = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]);
        nextIdx.push(idx[i]);
        continue;
      }
      const parent = pair(level[i], level[i + 1]);
      proof[idx[i]].push(level[i + 1]);
      proof[idx[i + 1]].push(level[i]);
      next.push(parent);
      nextIdx.push(idx[i]);
    }
    level = next;
    idx = nextIdx;
  }
  return { root: level[0], proofs: proof };
}

export function sessionPermissions(session) {
  const targets = session.targets || [];
  const selectors = session.selectors || [];
  if (!targets.length || !selectors.length) {
    throw new Error('A limited session needs one target and one selector.');
  }
  const valueLimit = session.valueLimit == null ? (1n << 256n) - 1n : BigInt(session.valueLimit);
  const perms = [];
  let index = 0;
  for (const target of targets) {
    for (const sig of selectors) {
      perms.push({ index, target, sig, valueLimit });
      index += 1;
    }
  }
  return perms;
}

export function sessionMerkle(session) {
  const perms = sessionPermissions(session);
  const leaves = perms.map(permissionLeaf);
  const tree = merkle(leaves);
  return { perms, ...tree };
}

function permBody(perm) {
  return encodePermission(perm).slice(2 + 64);
}

export function encodeBatchProof(perms, proofs) {
  const bodies = perms.map(permBody);
  // Offsets are from the first offset word, not from the length word.
  const arrHead = perms.length * 32;
  let cursor = arrHead;
  const arrOffsets = bodies.map((b) => {
    const off = cursor;
    cursor += b.length / 2;
    return word(off);
  });
  const arr = word(perms.length) + arrOffsets.join('') + bodies.join('');
  const proofBodies = (proofs || []).map((proof) => {
    const words = (proof || []).map((p) => p.replace(/^0x/i, '').padStart(64, '0'));
    return word(words.length) + words.join('');
  });
  const proofHead = proofBodies.length * 32;
  let pc = proofHead;
  const proofOffsets = proofBodies.map((b) => {
    const off = pc;
    pc += b.length / 2;
    return word(off);
  });
  const proofArr = word(proofBodies.length) + proofOffsets.join('') + proofBodies.join('');
  const head = word(0x40) + word(0x40 + arr.length / 2);
  return '0x' + head + arr + proofArr;
}

export function encodePermissionProof(perm, proof) {
  const leaf = encodePermission(perm).slice(2);
  const proofWords = (proof || []).map((p) => p.replace(/^0x/i, '').padStart(64, '0'));
  const head = word(0x40) + word(0x40 + leaf.length / 2);
  const tail = word(proofWords.length) + proofWords.join('');
  return '0x' + head + leaf + tail;
}
