import { isAddress, isBlockedDest } from './kernel.mjs';

export const DEST_7702 = 'This destination has a delegation. Native ETH is handled by that code.';

export function is7702(code) {
  return /^0xef0100/i.test(code || '');
}

export function destError({ dest, aa, needEth, destCode } = {}) {
  const d = String(dest || '').trim();
  if (!d) return '';
  if (!isAddress(d)) return 'Enter a wallet address.';
  if (isBlockedDest(d, aa)) {
    return aa && d.toLowerCase() === String(aa).trim().toLowerCase()
      ? 'Pick a different address, not this same account.'
      : 'Not zero or the ETH placeholder. Pick a wallet.';
  }
  if (needEth && is7702(destCode)) return DEST_7702;
  return '';
}
