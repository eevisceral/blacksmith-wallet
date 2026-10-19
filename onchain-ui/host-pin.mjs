export const VERSION_HOST = '0x15f850670574fB03C751B59726d8A1E411161aCD';
export const PAGE_KECCAK = '0x229703c776461c0e1fabdf4b0e5dc995fe83c147b69cfcab8fc9c812b01c0050';
export const PAGE_BYTES = 143682;
export const PAGE_CHUNKS = 6;

export function gatewayUrl(chain) {
  const label = chain === 8453 ? '8453' : '1';
  return `https://${VERSION_HOST}.${label}.w3link.io/`;
}
