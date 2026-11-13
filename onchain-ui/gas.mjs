import { word } from './util.mjs';

const GWEI = 10n ** 9n;

export function feesFromBlock(block) {
  const base = word((block && block.baseFeePerGas) || '0x0');
  // A 1 gwei tip on Base, where the base fee is a fraction of a gwei, locks a prefund larger than a small Kernel.
  const tip = base >= GWEI / 20n ? GWEI : base > 1000n ? base : 1000n;
  return { maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip };
}

export function opGas(nCalls) {
  const n = BigInt(nCalls < 1 ? 1 : nCalls);
  return {
    callGasLimit: 200000n + 80000n * n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
  };
}

export function outerHandleOpsGas(op, estimated) {
  const floor =
    BigInt(op.callGasLimit || 0n) +
    BigInt(op.verificationGasLimit || 0n) +
    BigInt(op.preVerificationGas || 0n) +
    100000n;
  let est = 0n;
  try {
    est = BigInt(estimated && estimated !== '0x' ? estimated : 0);
  } catch {
    est = 0n;
  }
  const padded = est + 50000n;
  return padded > floor ? padded : floor;
}
