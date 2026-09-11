/** Kernel 0.2.4 / EntryPoint v0.6 encoding. No SDK. RPC snapshot date: 2026-08-14. */

export const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
/** Legacy Kernel 0.2.4 factory (owned). Reconnect + rescue only. */
export const KERNEL_FACTORY = '0x5de4839a76cf55d0c90e2061ef4386d962E15ae3';
/** Permissionless CREATE2 factory. No owner. Same address on Ethereum and Base. */
export const ACCOUNT_FACTORY = '0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf';
export const KERNEL_IMPL = '0xd3082872F8B06073A021b4602e022d5A070d7cfC';
export const ECDSA_VALIDATOR = '0xd9AB5096a832b9ce79914329DAEE236f8Eea0390';

export const CHAINS = {
  1: {
    name: 'Ethereum',
    rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'],
    explorer: 'https://etherscan.io/tx/',
  },
  8453: {
    name: 'Base',
    rpcs: ['https://base-rpc.publicnode.com', 'https://base.drpc.org'],
    explorer: 'https://basescan.org/tx/',
  },
};

function explorerJoin(chain, suffix) {
  return CHAINS[chain].explorer.replace(/\/tx\/?$/, suffix);
}

export function explorerTx(chain, hash) {
  return CHAINS[chain].explorer + hash;
}

export function explorerAddress(chain, addr) {
  return explorerJoin(chain, '/address/') + addr;
}

export function explorerToken(chain, addr) {
  return explorerJoin(chain, '/token/') + addr;
}

/** Origin for wallet_addEthereumChain blockExplorerUrls. */
export function explorerOrigin(chain) {
  return explorerJoin(chain, '');
}

/** VersionHost after broadcast (CREATE2, same address on Ethereum and Base).
 *  Stays empty in the freeze: the host address is a function of this HTML, so
 *  baking it in is not a fixed point. Gateway / web3:// URLs still fill the card. */
export const PAGE_HOST = '';

const SUDO = '00000000';
export const EXECUTE_SEL = '51945447';
export const EXECUTE_BATCH_SEL = '34fcd5be';
const TRANSFER_SEL = 'a9059cbb';
const WITHDRAW_TO_SEL = '205c2878';
const GET_NONCE_SEL = '35567e1a';
const BALANCE_OF_SEL = '70a08231';
const INIT_SEL = 'd1f57894';
const GET_ACCOUNT_SEL = '4d6cb700';
const CREATE_SEL = '296601cd';
const FACTORY_GET_SEL = '0d253d76';
const FACTORY_CREATE_SEL = '5fbfb9cf';
const ALLOWED_IMPL_SEL = '6544c828';
const GET_USER_OP_HASH_SEL = 'a6193531';
export const HANDLE_OPS_SEL = '1fad948c';
export const CREATE_ACCOUNT_SEL = CREATE_SEL;
export const FACTORY_CREATE_ACCOUNT_SEL = FACTORY_CREATE_SEL;
export const FACTORY_GET_ACCOUNT_SEL = FACTORY_GET_SEL;
/** EIP-1967 implementation slot. */
export const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const USER_OP_TOPIC = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';
export const WITHDRAWN_TOPIC = '0xd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb';
/** Kernel Compatibility.sol `Received(address,uint256)` — sender not indexed. */
export const RECEIVED_TOPIC = '0x88a5966d370b9919b20f3e2c13ff65706f196a4e32cc2c12bf57088f88525874';

function strip(hex) {
  return hex.replace(/^0x/i, '').toLowerCase();
}

export function topicAddress(addr) {
  return '0x' + strip(addr).padStart(64, '0');
}

export function logTopicAddr(topic) {
  return '0x' + strip(topic || '').slice(-40);
}

/** UserOperationEvent data: nonce, success, actualGasCost, actualGasUsed. */
export function parseUserOpEventData(data) {
  const h = strip(data || '');
  if (h.length < 256) return null;
  return {
    nonce: BigInt('0x' + h.slice(0, 64)),
    ok: BigInt('0x' + h.slice(64, 128)) !== 0n,
    gasCost: BigInt('0x' + h.slice(128, 192)),
    gasUsed: BigInt('0x' + h.slice(192, 256)),
  };
}

export function parseWithdrawnData(data) {
  const h = strip(data || '');
  if (h.length < 128) return null;
  return { to: '0x' + h.slice(24, 64), amount: BigInt('0x' + h.slice(64, 128)) };
}

export function parseReceivedData(data) {
  const w = parseWithdrawnData(data);
  return w ? { from: w.to, amount: w.amount } : null;
}

function pad32(hex) {
  return strip(hex).padStart(64, '0');
}

function addrWord(a) {
  return pad32(strip(a));
}

export const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export const ETH_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export function isAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export function hasCode(hex) {
  const s = strip(String(hex || ''));
  return s.length > 0 && !/^0+$/.test(s);
}

export function accountFromWord(raw) {
  const a = '0x' + strip(String(raw || '')).slice(-40);
  return isAddress(a) && a !== ZERO_ADDR ? a : '';
}

/** Legacy deployed > this page's factory deployed > legacy funded rescue > this page's factory.
 *  If both are deployed, keep the richer one (tie → legacy) so a later older-factory
 *  create does not hide this page's account — unless `prefer` selects a live one.
 *  altAa is the other live Kernel so the page can name it. legacyStranded is set
 *  when we did not pick the older address and it still has ETH or a deposit with no code. */
export function pickAccount({
  legacyAddr,
  legacyCode,
  legacyEth = 0n,
  legacyDeposit = 0n,
  factoryOnChain,
  ourAddr,
  ourCode,
  ourEth = 0n,
  ourDeposit = 0n,
  prefer = '',
}) {
  const legacyOn = !!(legacyAddr && hasCode(legacyCode));
  const ourOn = !!(factoryOnChain && ourAddr && hasCode(ourCode));
  const legacyFunded = BigInt(legacyEth || 0n) > 0n || BigInt(legacyDeposit || 0n) > 0n;
  const legacyValue = BigInt(legacyEth || 0n) + BigInt(legacyDeposit || 0n);
  const ourValue = BigInt(ourEth || 0n) + BigInt(ourDeposit || 0n);
  const ours = { aa: ourAddr, source: 'ours', deployed: true, rescue: false, factoryMissing: false };
  const legacy = { aa: legacyAddr, source: 'legacy', deployed: true, rescue: false, factoryMissing: false };
  let picked;
  if (legacyOn && ourOn) {
    if (prefer === 'ours') picked = ours;
    else if (prefer === 'legacy') picked = legacy;
    else picked = ourValue > legacyValue ? ours : legacy;
  } else if (legacyOn) {
    picked = { aa: legacyAddr, source: 'legacy', deployed: true, rescue: false, factoryMissing: false };
  } else if (ourOn) {
    picked = { aa: ourAddr, source: 'ours', deployed: true, rescue: false, factoryMissing: false };
  } else if (legacyAddr && legacyFunded) {
    picked = { aa: legacyAddr, source: 'legacy', deployed: false, rescue: true, factoryMissing: !factoryOnChain };
  } else if (factoryOnChain && ourAddr) {
    picked = { aa: ourAddr, source: 'ours', deployed: false, rescue: false, factoryMissing: false };
  } else {
    picked = { aa: '', source: '', deployed: false, rescue: false, factoryMissing: true };
  }
  const stranded = !!(
    legacyAddr &&
    legacyFunded &&
    !legacyOn &&
    picked.aa &&
    picked.aa.toLowerCase() !== legacyAddr.toLowerCase()
  );
  const altAa = legacyOn && ourOn ? (picked.source === 'ours' ? legacyAddr : ourAddr) : '';
  const altSource = legacyOn && ourOn ? (picked.source === 'ours' ? 'legacy' : 'ours') : '';
  return { ...picked, legacyStranded: stranded, altAa, altSource };
}

/** EntryPoint v0.6 FailedOp / revert text. AA23 is validation revert — not a signature miss. */
export function classifyHandleOpsRevert(msg) {
  const m = String(msg || '');
  if (/AA21|didn't pay prefund/i.test(m)) return 'prefund';
  if (/AA24|invalid signature|signature error/i.test(m)) return 'sig';
  return 'other';
}

/** AA21 / execute-value check after EntryPoint takes prefund from deposit then Kernel ETH. */
export function missingPrefund(kernelEth, deposit, ethOut, epOut, prefund) {
  const k = BigInt(kernelEth);
  const d = BigInt(deposit);
  const eOut = BigInt(ethOut);
  const pOut = BigInt(epOut);
  const p = BigInt(prefund);
  const fromKernel = d >= p ? 0n : p - d;
  if (k < fromKernel) return 'prefund';
  if (k - fromKernel < eOut) return 'eth';
  const depLeft = d >= p ? d - p : 0n;
  if (depLeft < pOut) return 'ep';
  return '';
}

/** Gateway / web3:// URL, else PAGE_HOST after a VersionHost broadcast. */
export function pageHostFromLocation(loc, pinned = PAGE_HOST) {
  const hn = String(loc?.hostname || '').toLowerCase();
  const m = hn.match(/^(0x[a-f0-9]{40})(?:\.(\d+))?\.(w3link\.io|w3eth\.io)$/);
  if (m) return { addr: m[1], chain: m[2] ? Number(m[2]) : 1 };
  if (String(loc?.protocol || '') === 'web3:') {
    const blob = `${loc['host'] || ''}${loc.pathname || ''}`.toLowerCase();
    const a = blob.match(/0x[a-f0-9]{40}/);
    if (a) {
      const c = blob.match(/:(1|8453)(?=\/|$)/);
      return { addr: a[0], chain: c ? Number(c[1]) : 1 };
    }
  }
  if (pinned && isAddress(pinned)) return { addr: pinned.toLowerCase(), chain: 1 };
  return null;
}

/** Zero, the ETH placeholder, or the Kernel itself — not a send dest / token. */
export function isBlockedDest(dest, account) {
  const a = dest.trim().toLowerCase();
  if (a === ZERO_ADDR || a === ETH_PLACEHOLDER) return true;
  return !!(account && a === account.trim().toLowerCase());
}

function u256(n) {
  return BigInt(n).toString(16).padStart(64, '0');
}

function encodeBytes(hex) {
  const s = strip(hex);
  const len = s.length / 2;
  const padded = s.padEnd(Math.ceil(len / 32) * 64 || 0, '0');
  return u256(len) + padded;
}

/** execute(address,uint256,bytes,uint8) — operation must be 0. */
export function encodeExecute(to, value, data) {
  const d = strip(data || '');
  const head = addrWord(to) + u256(value) + u256(128) + u256(0);
  return '0x' + EXECUTE_SEL + head + encodeBytes(d);
}

/** executeBatch((address,uint256,bytes)[]) */
export function encodeExecuteBatch(calls) {
  let dyn = u256(calls.length);
  let offset = 32 * calls.length;
  const offsetWords = [];
  const encodedCalls = [];
  for (const c of calls) {
    offsetWords.push(u256(offset));
    const dataEnc = encodeBytes(strip(c.data || ''));
    const callEnc = addrWord(c.to) + u256(c.value) + u256(96) + dataEnc;
    encodedCalls.push(callEnc);
    offset += callEnc.length / 2;
  }
  dyn += offsetWords.join('') + encodedCalls.join('');
  return '0x' + EXECUTE_BATCH_SEL + u256(32) + dyn;
}

export function encodeTransfer(to, amount) {
  return '0x' + TRANSFER_SEL + addrWord(to) + u256(amount);
}

export function encodeWithdrawTo(to, amount) {
  return '0x' + WITHDRAW_TO_SEL + addrWord(to) + u256(amount);
}

export function encodeBalanceOf(owner) {
  return '0x' + BALANCE_OF_SEL + addrWord(owner);
}

export function encodeGetNonce(sender) {
  return '0x' + GET_NONCE_SEL + addrWord(sender) + u256(0);
}

/** initialize(validator, owner as 20-byte bytes) */
function encodeInitialize(owner) {
  const ownerBytes = strip(owner);
  return '0x' + INIT_SEL + addrWord(ECDSA_VALIDATOR) + u256(64) + encodeBytes(ownerBytes);
}

export function encodeGetAccountAddress(owner) {
  const init = strip(encodeInitialize(owner));
  return '0x' + GET_ACCOUNT_SEL + u256(64) + u256(0) + encodeBytes(init);
}

/** Legacy factory createAccount(implementation, initialize(validator, owner), index) */
export function encodeCreateAccount(owner, index = 0n) {
  const init = strip(encodeInitialize(owner));
  return '0x' + CREATE_SEL + addrWord(KERNEL_IMPL) + u256(96) + u256(index) + encodeBytes(init);
}

/** This page's factory getAccountAddress(owner, index) */
export function encodeFactoryGetAccount(owner, index = 0n) {
  return '0x' + FACTORY_GET_SEL + addrWord(owner) + u256(index);
}

/** This page's factory createAccount(owner, index) */
export function encodeFactoryCreate(owner, index = 0n) {
  return '0x' + FACTORY_CREATE_SEL + addrWord(owner) + u256(index);
}

export function encodeIsAllowedImplementation(impl) {
  return '0x' + ALLOWED_IMPL_SEL + addrWord(impl || KERNEL_IMPL);
}

export function packSudoSignature(ecdsa65) {
  const s = strip(ecdsa65);
  if (s.length !== 130) throw new Error('ECDSA signature must be 65 bytes');
  return '0x' + SUDO + s;
}

export function requiredPrefund(callGas, verificationGas, preVerificationGas, maxFeePerGas) {
  return (callGas + verificationGas + preVerificationGas) * maxFeePerGas;
}

/** Native out leaves prefund + buffer on the Kernel. Deposit does not pay execute value. */
export function nativeOutValue(kernelEth, prefund) {
  const k = BigInt(kernelEth);
  const p = BigInt(prefund);
  const buffer = p / 10n > 10n ** 14n ? p / 10n : 10n ** 14n; // 10% or 0.0001 ETH
  const need = p + buffer;
  if (k <= need) return 0n;
  return k - need;
}

/** EntryPoint locks requiredPrefund from the deposit before execute. */
export function epOutValue(epDeposit, prefund) {
  const d = BigInt(epDeposit);
  const p = BigInt(prefund);
  if (d <= p) return 0n;
  return d - p;
}

/** Decimal string → wei. Rejects extra fractional digits. */
export function parseAmt(s, decimals) {
  const t = String(s || '')
    .trim()
    .replace(/,/g, '');
  if (!t || !/^\d+(\.\d*)?$|^\.\d+$/.test(t)) throw new Error('Enter an amount.');
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) throw new Error('Enter an amount.');
  const [wRaw, fRaw = ''] = t.split('.');
  if (fRaw.length > d) throw new Error('Too many decimal places.');
  return BigInt((wRaw || '0') + (d ? fRaw.padEnd(d, '0') : ''));
}

export function encodeGetUserOpHash(op) {
  const tuple = encodeUserOpTuple(op);
  return '0x' + GET_USER_OP_HASH_SEL + u256(32) + tuple;
}

export function encodeHandleOps(op, beneficiary) {
  const tuple = encodeUserOpTuple(op);
  const arr = u256(1) + u256(32) + tuple;
  return '0x' + HANDLE_OPS_SEL + u256(64) + addrWord(beneficiary) + arr;
}

function encodeUserOpTuple(op) {
  const initCode = strip(op.initCode || '0x');
  const callData = strip(op.callData);
  const pm = strip(op.paymasterAndData || '0x');
  const sig = strip(op.signature);
  // static: sender, nonce, initOff, callOff, callGas, verif, pre, maxFee, maxPrio, pmOff, sigOff
  const staticSize = 11 * 32;
  let offset = staticSize;
  const chunks = [];
  function pushBytes(s) {
    const enc = encodeBytes(s);
    chunks.push({ off: offset, enc });
    offset += enc.length / 2;
    return chunks.length - 1;
  }
  const iInit = pushBytes(initCode);
  const iCall = pushBytes(callData);
  const iPm = pushBytes(pm);
  const iSig = pushBytes(sig);
  const head =
    addrWord(op.sender) +
    u256(op.nonce) +
    u256(chunks[iInit].off) +
    u256(chunks[iCall].off) +
    u256(op.callGasLimit) +
    u256(op.verificationGasLimit) +
    u256(op.preVerificationGas) +
    u256(op.maxFeePerGas) +
    u256(op.maxPriorityFeePerGas) +
    u256(chunks[iPm].off) +
    u256(chunks[iSig].off);
  return head + chunks.map((c) => c.enc).join('');
}

const RPC_PAGE = 'The RPC returned a web page instead of chain data. Check the RPC URL.';

/** JSON-RPC body. HTML (DOCTYPE) is a wrong URL or an upstream error page. */
export function parseRpcJson(text) {
  const t = String(text || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!t || t[0] === '<') throw new Error(RPC_PAGE);
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error(RPC_PAGE);
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(RPC_PAGE);
  return j;
}
