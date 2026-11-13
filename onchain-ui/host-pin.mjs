export const VERSION_HOST = '0x49B11598f0b745AcC009c3a70F3fF42e1DCF973c';
export const PAGE_KECCAK = '0x2d1c79e8eb63a38ba6dac64026b0c76c30c039e2ebf8040cf73c9388061188be';
export const PAGE_BYTES = 147062;
export const PAGE_CHUNKS = 6;

export function gatewayUrl(chain) {
  const label = chain === 8453 ? '8453' : '1';
  return `https://${VERSION_HOST}.${label}.w3link.io/`;
}
