/** Kernel 0.2.4 / EntryPoint v0.6 encoding. No SDK. */

export const ENTRY_POINT = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
/** Legacy Kernel 0.2.4 factory (owned). Reconnect + rescue only. */
export const KERNEL_FACTORY = '0x5de4839a76cf55d0c90e2061ef4386d962E15ae3';
/** Permissionless CREATE2 factory. No owner. Same address on Ethereum and Base. */
export const ACCOUNT_FACTORY = '0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf';
export const KERNEL_IMPL = '0xd3082872F8B06073A021b4602e022d5A070d7cfC';
/** Kernel 0.2.1 — same execute encoding, no executeBatch. */
export const KERNEL_IMPL_V21 = '0xf048AD83CB2dfd6037A43902a2A5Be04e53cd2Eb';
/** 0.2.x implementations this page can send with (ECDSA + execute). New creates stay KERNEL_IMPL. */
export const KERNEL_V2_IMPLS = [
  KERNEL_IMPL_V21,
  '0x8dD4DBB54d8A8Cf0DE6F9CCC4609470A30EfF18C',
  '0x0DA6a956B9488eD4dd761E59F52FDc6c8068E6B5',
  '0xD3F582F6B4814E989Ee8E96bc3175320B5A540ab',
  '0x5FC0236D6c88a65beD32EECDC5D60a5CAb377717',
  KERNEL_IMPL,
];
export const ECDSA_VALIDATOR = '0xd9AB5096a832b9ce79914329DAEE236f8Eea0390';
/** Kernel v2 / EntryPoint v0.6 session-key validator (same CREATE2 on Ethereum and Base). */
export const SESSION_KEY_VALIDATOR = '0x5C06CE2b673fD5E6e56076e40DD46aB67f5a72A5';
/** keccak256("ValidatorApproved(bytes4 sig,uint256 validatorData,address executor,bytes enableData)") */
export const VALIDATOR_APPROVED_STRUCT_HASH =
  '0x3ce406685c1b3551d706d85a68afdaa49ac4e07b451ad9b8ff8b58c3ee964176';
export const EIP712_DOMAIN_TYPEHASH =
  '0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f';
export const KERNEL_EIP712_NAME = 'Kernel';
export const KERNEL_EIP712_VERSION = '0.2.4';

/** Packed 20-byte tokens (no 0x); same contracts as the quoted list, lowercase. */
function hexAddrs(s) {
  const o = [];
  for (let i = 0; i < s.length; i += 40) o.push('0x' + s.slice(i, i + 40));
  return o;
}

/** Pinned 2026-09-17 from chainlist.org/rpcs.json, probed live for deep (2023) receipts.
 *  Every URL here served unaddressed 2023 Transfer logs; order is measured latency.
 *  The page does not fetch Chainlist. */
export const CHAINS = {
  1: {
    name: 'Ethereum',
    rpcs: [
      'https://gateway.tenderly.co/public/mainnet',
      'https://ethereum-public.nodies.app',
      'https://ethereum.public.blockpi.network/v1/rpc/public',
      'https://mainnet.rpc.sentio.xyz',
      'https://eth.api.pocket.network',
    ],
    explorer: 'https://etherscan.io/tx/',
    // High-cap ERC-20s probed with balanceOf at head, so holdings show even when
    // the node cannot serve old Transfer logs. Balances still come from the contracts.
    majors: hexAddrs(
      'c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48dac17f958d2ee523a2206206994597c13d831ec76b175474e89094c44da98b954eedeac495271d0f2260fac5e5542a773aa44fbcfedf7c193bc2c5991f9840a85d5af5bf1d1762f925bdaddc4201f984514910771af9ca656af840dff83e8264ecf986ca95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce6982508145454ce325ddbe47a25d4ec3d2311933ae7ab96520de3a18e5e111b5eaab095312d7fe847f39c581f595b53c5cb19bd0b3f8da6c935e2ca0ae78736cd615f374d3085123a210448e74fc6393be9895146f7af43049ca1c1ae358b0541ea497047fc66500c84a76ad7e9c93437bfc5ac33e2ddae99f8f72aa9304c8b593d555f12ef6589cc3a579a25a98fcbea516cf06857215779fd812ca3bef1b32d533a949740bb3306d119cc777fa900ba034cd52c011a73ee8576fb46f5e1c5751ca3b9fe0af2a6fc00e94cb662c3520282e6f5717214004a7f26888c944e90c64b2c07662a292be6244bdf05cda44a7c18360217d8f7ab5e7c516566761ea12ce7f9d72b50721bcf8d664c30412cfbc6cf7a15145234ad142000000000000000000000000000000000000426de037ef9ad2725eb40118bb1702ebb27e4aeb24aea46a60368a7bd060eec7df8cba43b7ef41ad8545804880de22913dafe09f4980848ece6ecbaf78faba6f8e4a5e8ab82f62fe7c39859fa577269be34c9edd5852cd905f086c759e8383e09bff1e68b36c3ea9036406852006290770bedfcaba0e23a0e8853d955acef822db058eb8505911ed77f175b99e5f98805a4e8be255a32880fdec7f6728c6568ba0f939e0a03fb07f59a73314e73794be0e57ac1b4e40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2fcd5fe23c85820f7b72d0926fc9b05b43e359b7eebf5495efe5db9ce00f80364c8b423567e58d2110a1290d69c65a6fe4df752f95823fae25cb99e5a7ec53bf9167f50cdeb3ae105f56099aaab9061f83455e53cbb86018ac2b8092fdcd39d8444affc3f64d224452801aced8b2f0aebe155379bb5d5943813845badade8e6dff049820680d1f14bd3903a5d00f5d2fb29fb7d3cfee444a200298f468908cc9420d8775f648430679a709e98d2b0cb6250d2887efe41d2489571d322189246dafa5ebde1f4699f498ba100000625a3754423978a60c9317c58a424e3d0bc529c00c6401aef6d220be8c6ea1667f6ad93e111111111117dc0aa78b770fa6a738034120c302d33526068d116ce69f19a9ee46f0bd304f21a51f6810e776880c02933d47db1b9fc05908e5386b965283d291dbcf85356a21ba090e6db59121208b4456072c95faa701256059aa122697b133aded9279dc035d45d973e3ec169d2276ddab16f1e407384f',
    ),
  },
  8453: {
    name: 'Base',
    rpcs: [
      'https://base.rpc.sentio.xyz',
      'https://base-public.nodies.app',
      'https://base-mainnet.public.blastapi.io',
      'https://mainnet.base.org',
      'https://gateway.tenderly.co/public/base',
    ],
    explorer: 'https://basescan.org/tx/',
    majors: hexAddrs(
      '4200000000000000000000000000000000000006833589fcd6edb6e08f4c7c32d4f71b54bda02913d9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca50c5725949a6f0c72e6c4a641f24049a917db0cb2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22cbb7c0000ab88b473b1f5afd9ef808440eed33bf940181a94a35a4569e4529a3cdfb74e38fd986314ed4e862860bed51a9570b96d89af5e1b0efefed532f27101965dd16442e59d40670faf5ebb142e4ac1bd2486aaf3b5c0fc3fd868558b082a531b2b4c1cba3fcea344f92d9239c08c0568f6f2f0ee4520b3e328455c4059eeb9e3f84b5543f74e24e7e1b1bc0c42215582d5a085795f4badbac3ff36d1bcb0578d8a44db98b23bf096a382e016e29a5ce0ffe60a3e35cc302bfa44cb288bc5a4f316fdb1adb421111111111166b7fe7bd91427724b487980afc69a88594d404727625a9437c3f886c7643872296aebaa5cc21fd487b8fcc2f632f3f4e8d37262a0842a99f6e6785da0f5d6fb42495fe424bce029eeb2e04c0599ae5a44757c0af6f9ec3b93da8976c150a820c137fa70c8691f0e44dc420a5e53c168921dc1c7a460413dd4e964f96d8dfc56e7223ce88cd85b1a03eda10342529bbf8eb700a06c60441fef25d4f9fd6be4a90f2620860d680c0d4d5fb53d1a825',
    ),
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
export const SIG_MODE_SUDO = SUDO;
export const SIG_MODE_PLUGIN = '00000001';
export const SIG_MODE_ENABLE = '00000002';
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

export function kernelExecImpl(impl) {
  const a = strip(impl);
  return KERNEL_V2_IMPLS.some((x) => strip(x) === a);
}

export function kernelBatchImpl(impl) {
  return kernelExecImpl(impl) && strip(impl) !== strip(KERNEL_IMPL_V21);
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

export function packPluginSignature(validator, body) {
  return '0x' + SIG_MODE_PLUGIN + strip(validator).padStart(40, '0') + strip(body);
}

/** SessionKeyValidator enable() payload: key ‖ merkleRoot ‖ validAfter ‖ validUntil ‖ paymaster ‖ nonce. merkleRoot 0 = session-key ECDSA only (validator-level; MCP policy still applies). */
export function encodeSessionEnableData({
  sessionKey,
  merkleRoot = '0x' + '00'.repeat(32),
  validAfter = 0,
  validUntil = 0xfffffffffffe,
  paymaster = '0x0000000000000000000000000000000000000000',
  nonce,
}) {
  const va = BigInt(validAfter).toString(16).padStart(12, '0');
  const vu = BigInt(validUntil).toString(16).padStart(12, '0');
  return (
    '0x' +
    strip(sessionKey).padStart(40, '0') +
    strip(merkleRoot).padStart(64, '0') +
    va +
    vu +
    strip(paymaster).padStart(40, '0') +
    BigInt(nonce).toString(16).padStart(64, '0')
  );
}

export function encodeSessionDisableKey(sessionKey) {
  return '0x' + strip(sessionKey).padStart(40, '0');
}

/** SessionKeyValidator.validateUserOp inner signature: session key address ‖ 65-byte ECDSA (personal_sign of userOpHash). */
export function packSessionKeyBody(sessionKey, ecdsa65) {
  const s = strip(ecdsa65);
  if (s.length !== 130) throw new Error('ECDSA signature must be 65 bytes');
  return '0x' + strip(sessionKey).padStart(40, '0') + s;
}

export function packSessionPluginSignature(sessionKey, ecdsa65, validator = SESSION_KEY_VALIDATOR) {
  return packPluginSignature(validator, packSessionKeyBody(sessionKey, ecdsa65));
}

/** 32-byte validatorData used in enable-mode signatures and ValidatorApproved. */
export function sessionValidatorData(validAfter, validUntil, validator = SESSION_KEY_VALIDATOR) {
  return (
    '0x' +
    BigInt(validAfter).toString(16).padStart(12, '0') +
    BigInt(validUntil).toString(16).padStart(12, '0') +
    strip(validator).padStart(40, '0')
  );
}

/**
 * Kernel mode 0x00000002: approve a validator for this callData selector, enable() it, then validate the UserOp.
 * Layout: mode ‖ validAfter(6) ‖ validUntil(6) ‖ validator(20) ‖ executor(20) ‖ enableDataLen(32) ‖ enableData ‖ enableSigLen(32) ‖ enableSig ‖ validatorSig.
 */
export function packEnableSignature({
  validAfter = 0,
  validUntil = 0xfffffffffffe,
  validator = SESSION_KEY_VALIDATOR,
  executor = ZERO_ADDR,
  enableData,
  enableSig,
  validatorSig,
}) {
  const ed = strip(enableData);
  const es = strip(enableSig);
  const vs = strip(validatorSig);
  return (
    '0x' +
    SIG_MODE_ENABLE +
    BigInt(validAfter).toString(16).padStart(12, '0') +
    BigInt(validUntil).toString(16).padStart(12, '0') +
    strip(validator).padStart(40, '0') +
    strip(executor).padStart(40, '0') +
    u256(ed.length / 2) +
    ed +
    u256(es.length / 2) +
    es +
    vs
  );
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
