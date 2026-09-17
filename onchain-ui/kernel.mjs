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
    majors: [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      '0x514910771AF9Ca656af840dff83E8264EcF986CA',
      '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE',
      '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
      '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      '0xae78736Cd615f374D3085123A210448E74Fc6393',
      '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704',
      '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
      '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32',
      '0xD533a949740bb3306d119CC777fa900bA034cd52',
      '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F',
      '0xc00e94Cb662C3520282E6f5717214004A7f26888',
      '0xc944E90C64B2c07662A292be6244BDf05Cda44a7',
      '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72',
      '0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1',
      '0x4200000000000000000000000000000000000042',
      '0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24',
      '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85',
      '0x45804880De22913dAFE09f4980848ECE6EcbAf78',
      '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3',
      '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3',
      '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8',
      '0x853d955aCEf822Db058eb8505911ED77F175b99e',
      '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0',
      '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E',
      '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f',
      '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee',
      '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110',
      '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7',
      '0xec53bF9167f50cDEB3Ae105f56099aaaB9061F83',
      '0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6',
      '0x4d224452801ACEd8B2F0aebE155379bb5D594381',
      '0x3845badAde8e6dFF049820680d1F14bD3903a5d0',
      '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942',
      '0x0D8775F648430679A709E98d2b0Cb6250d2887EF',
      '0xE41d2489571d322189246DaFA5ebDe1F4699F498',
      '0xba100000625a3754423978a60c9317c58a424e3D',
      '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
      '0x111111111117dC0aa78b770fA6A738034120C302',
      '0xD33526068D116cE69F19A9ee46F0bd304F21A51f',
      '0x6810e776880C02933D47DB1b9fc05908e5386b96',
      '0x5283D291DBCF85356A21bA090E6db59121208b44',
      '0x56072C95FAA701256059aa122697B133aDEd9279',
      '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
    ],
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
    majors: [
      '0x4200000000000000000000000000000000000006',
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
      '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
      '0x532f27101965dd16442E59d40670FaF5eBB142E4',
      '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',
      '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
      '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
      '0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb',
      '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe',
      '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
      '0x1111111111166b7FE7bd91427724B487980aFc69',
      '0xA88594D404727625A9437C3f886C7643872296AE',
      '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842',
      '0xA99F6e6785Da0F5d6fB42495Fe424BCE029Eeb2E',
      '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A',
      '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc',
      '0x1C7a460413dD4e964f96D8dFC56E7223cE88CD85',
      '0xB1a03EdA10342529bBF8EB700a06C60441fEf25d',
      '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825',
    ],
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
