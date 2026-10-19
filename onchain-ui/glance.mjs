import { fmtEth } from './util.mjs';

export function glanceText({ deployed, eth, err, aa, factoryOnChain }) {
  if (err) return err;
  if (!aa) return factoryOnChain ? 'Not created' : 'Factory is not on this chain yet.';
  const bal = BigInt(eth || 0n);
  const held = bal > 0n ? ` · ${fmtEth(bal)}` : '';
  if (!deployed) return `Not created${held}`;
  return `Created · ${fmtEth(bal)}`;
}

export function glanceCreateLabel(name, rescue) {
  return rescue ? `Create older Kernel on ${name}` : `Create on ${name}`;
}
