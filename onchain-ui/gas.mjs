/** UserOp v0.6 fee and gas limits shared by the page and the agent. Unused prefund refunds to the Kernel. */

import { word } from './util.mjs';

const TIP = 10n ** 9n;

export function feesFromBlock(block) {
  const base = word((block && block.baseFeePerGas) || '0x0');
  return { maxFeePerGas: base * 2n + TIP, maxPriorityFeePerGas: TIP };
}

export function opGas(nCalls) {
  const n = BigInt(nCalls < 1 ? 1 : nCalls);
  return {
    callGasLimit: 200000n + 80000n * n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
  };
}
