import { isAddress, isBlockedDest } from './kernel.mjs';

export const DEST_7702 = 'This account delegates to another contract. Sending ETH here runs that code.';

export function is7702(code) {
  return /^0xef0100/i.test(code || '');
}

export function destError({ dest, aa } = {}) {
  const d = String(dest || '').trim();
  if (!d) return '';
  if (!isAddress(d)) return 'Enter an address.';
  if (isBlockedDest(d, aa)) {
    return aa && d.toLowerCase() === String(aa).trim().toLowerCase()
      ? 'That is this Kernel. Enter a different address.'
      : 'Zero and the ETH placeholder are not destinations.';
  }
  return '';
}
