/** Decode-only helpers shared by policy (avoids importing the full tools module). */
import { EXECUTE_SEL, EXECUTE_BATCH_SEL } from '../onchain-ui/kernel.mjs';

const stripHex = (h) =>
  String(h || '')
    .replace(/^0x/i, '')
    .toLowerCase();

export function decodeCallData(callData) {
  const h = stripHex(callData);
  if (h.length < 8) throw new Error('callData is too short.');
  const sel = h.slice(0, 8);
  const body = h.slice(8);
  const w = (i) => body.slice(i * 64, i * 64 + 64);
  if (sel === EXECUTE_SEL) {
    if (body.length < 256) throw new Error('truncated execute callData.');
    const bOff = Number(BigInt('0x' + w(2))) * 2;
    if (body.length < bOff + 64) throw new Error('truncated execute callData.');
    const len = Number(BigInt('0x' + body.slice(bOff, bOff + 64)));
    return {
      kind: 'execute',
      operation: Number(BigInt('0x' + w(3))),
      calls: [{ to: '0x' + w(0).slice(24), value: BigInt('0x' + w(1)), data: '0x' + body.slice(bOff + 64, bOff + 64 + len * 2) }],
    };
  }
  if (sel === EXECUTE_BATCH_SEL) {
    const arrOff = Number(BigInt('0x' + w(0))) * 2;
    const count = Number(BigInt('0x' + body.slice(arrOff, arrOff + 64)));
    const base = arrOff + 64;
    const calls = [];
    for (let i = 0; i < count; i++) {
      const rel = Number(BigInt('0x' + body.slice(base + i * 64, base + i * 64 + 64))) * 2;
      const cs = base + rel;
      if (body.length < cs + 192) throw new Error('truncated executeBatch callData.');
      const dOff = Number(BigInt('0x' + body.slice(cs + 128, cs + 192))) * 2;
      const len = Number(BigInt('0x' + body.slice(cs + dOff, cs + dOff + 64)));
      calls.push({
        to: '0x' + body.slice(cs + 24, cs + 64),
        value: BigInt('0x' + body.slice(cs + 64, cs + 128)),
        data: '0x' + body.slice(cs + dOff + 64, cs + dOff + 64 + len * 2),
      });
    }
    return { kind: 'executeBatch', calls };
  }
  return { kind: 'other', selector: '0x' + sel, calls: [] };
}
