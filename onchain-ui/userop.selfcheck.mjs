import {
  CREATE_ACCOUNT_SEL,
  FACTORY_CREATE_ACCOUNT_SEL,
  FACTORY_GET_ACCOUNT_SEL,
  ECDSA_VALIDATOR,
  ENTRY_POINT,
  EXECUTE_SEL,
  EXECUTE_BATCH_SEL,
  HANDLE_OPS_SEL,
  KERNEL_FACTORY,
  ACCOUNT_FACTORY,
  KERNEL_IMPL,
  KERNEL_IMPL_V21,
  kernelExecImpl,
  kernelBatchImpl,
  EIP1967_IMPL_SLOT,
  encodeCreateAccount,
  encodeFactoryCreate,
  encodeFactoryGetAccount,
  encodeIsAllowedImplementation,
  encodeExecute,
  encodeExecuteBatch,
  encodeTransfer,
  encodeWithdrawTo,
  encodeGetUserOpHash,
  encodeHandleOps,
  packSudoSignature,
  parseRpcJson,
  parseAmt,
  nativeOutValue,
  epOutValue,
  requiredPrefund,
  missingPrefund,
  pickAccount,
  classifyHandleOpsRevert,
  hasCode,
  accountFromWord,
  isBlockedDest,
  isAddress,
  pageHostFromLocation,
  PAGE_HOST,
  CHAINS,
  ZERO_ADDR,
  ETH_PLACEHOLDER,
  USER_OP_TOPIC,
  WITHDRAWN_TOPIC,
  RECEIVED_TOPIC,
  parseUserOpEventData,
  parseWithdrawnData,
  parseReceivedData,
  logTopicAddr,
  TRANSFER_TOPIC,
  topicAddress,
} from './kernel.mjs';
import { renderMd, fillSkill, esc, short, hex, word, fmtAmt } from './util.mjs';
import { decodeStr, logsFrom, getRpcUrl, getRpcAlts, setRpcUrl, archiveLogsMsg, addrRequiredLogsMsg, rangeLogsMsg, pruneFloor, transientRpcMsg, timeoutLogsMsg, unservedLogsMsg, getLogs, walkTransfersIn, scanAccountLogs, TOK_WALK_PUBLIC, TOK_WALK_CUSTOM, LOGS_RANGE_MAX, LOGS_LOOKBACK, LOGS_TIMEOUT_PUBLIC, LOGS_TIMEOUT_CUSTOM } from './rpc.mjs';
import { HIST_CAP, HIST_V, HIST_TS } from './history.mjs';
import { getPendingTx, setPendingTx, forgetPendingTx, sendFail } from './send.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUN_PIN } from './bun-pin.mjs';

function eq(name, a, b) {
  const A = String(a).toLowerCase();
  const B = String(b).toLowerCase();
  if (A !== B) {
    console.error(`FAIL ${name}\n got ${A}\n exp ${B}`);
    process.exit(1);
  }
}

eq('execute selector', EXECUTE_SEL, '51945447');
eq('createAccount selector', CREATE_ACCOUNT_SEL, '296601cd');
eq('factory createAccount selector', FACTORY_CREATE_ACCOUNT_SEL, '5fbfb9cf');
eq('factory getAccountAddress selector', FACTORY_GET_ACCOUNT_SEL, '0d253d76');
eq('account factory', ACCOUNT_FACTORY, '0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf');
eq(
  'encodeFactoryCreate',
  encodeFactoryCreate('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  '0x5fbfb9cf000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000000'
);
eq(
  'encodeFactoryGetAccount',
  encodeFactoryGetAccount('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  '0x0d253d76000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000000'
);
eq(
  'encodeIsAllowedImplementation',
  encodeIsAllowedImplementation(KERNEL_IMPL),
  '0x6544c828000000000000000000000000d3082872f8b06073a021b4602e022d5a070d7cfc'
);
eq('eip1967 impl slot', EIP1967_IMPL_SLOT, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc');
eq(
  'encodeCreateAccount',
  encodeCreateAccount('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  '0x296601cd000000000000000000000000d3082872f8b06073a021b4602e022d5a070d7cfc000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000084d1f57894000000000000000000000000d9ab5096a832b9ce79914329daee236f8eea039000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000014f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000000000000000000000000000'
);
eq('executeBatch selector', EXECUTE_BATCH_SEL, '34fcd5be');
if (!kernelExecImpl(KERNEL_IMPL) || !kernelExecImpl(KERNEL_IMPL_V21) || kernelExecImpl('0x0000000000000000000000000000000000000001')) {
  console.error('FAIL kernelExecImpl');
  process.exit(1);
}
if (kernelBatchImpl(KERNEL_IMPL_V21) || !kernelBatchImpl(KERNEL_IMPL)) {
  console.error('FAIL kernelBatchImpl');
  process.exit(1);
}
eq('LOGS_RANGE_MAX', LOGS_RANGE_MAX, 9999);
eq('LOGS_LOOKBACK', LOGS_LOOKBACK, 120000);
if (!archiveLogsMsg('Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode')) {
  console.error('FAIL archiveLogsMsg Allnodes');
  process.exit(1);
}
if (!archiveLogsMsg('historical state is not available')) {
  console.error('FAIL archiveLogsMsg historical state');
  process.exit(1);
}
if (archiveLogsMsg('RPC HTTP 403') || archiveLogsMsg('403')) {
  console.error('FAIL archiveLogsMsg must not treat 403 as archive');
  process.exit(1);
}
if (!addrRequiredLogsMsg('Please specify an address in your request')) {
  console.error('FAIL addrRequiredLogsMsg');
  process.exit(1);
}
if (archiveLogsMsg('ranges over 10000 blocks are not supported on free plan')) {
  console.error('FAIL archiveLogsMsg must not treat dRPC range as archive');
  process.exit(1);
}
if (!rangeLogsMsg('block span 120000 of range [1, 120001] exceeds the limit 10000')) {
  console.error('FAIL rangeLogsMsg Sentio span');
  process.exit(1);
}
if (!rangeLogsMsg('ranges over 10000 blocks are not supported on free plan')) {
  console.error('FAIL rangeLogsMsg dRPC ranges over');
  process.exit(1);
}
eq(
  'pruneFloor parses the receipts floor',
  pruneFloor('old data not available due to pruning: requested block 25609173, history is available from block 25735899'),
  25735899
);
if (pruneFloor('execution reverted') !== 0 || pruneFloor('history is not available due to pruning') !== -1) {
  console.error('FAIL pruneFloor must distinguish floor-less pruning and non-pruning errors');
  process.exit(1);
}
if (!transientRpcMsg('internal error: relay request failed with status code 408 after 2 attempts')) {
  console.error('FAIL transientRpcMsg must catch relay 408');
  process.exit(1);
}
if (!transientRpcMsg('RPC HTTP 503') || !transientRpcMsg('bad gateway')) {
  console.error('FAIL transientRpcMsg must catch 5xx and gateway errors');
  process.exit(1);
}
if (transientRpcMsg('execution reverted') || transientRpcMsg('insufficient funds')) {
  console.error('FAIL transientRpcMsg must not swallow real reverts');
  process.exit(1);
}
for (const id of [1, 8453]) {
  const m = CHAINS[id].majors;
  if (!Array.isArray(m) || m.length < 20 || m.some((a) => !isAddress(a))) {
    console.error('FAIL CHAINS majors must be 20+ valid token addresses per chain');
    process.exit(1);
  }
}
eq('handleOps selector', HANDLE_OPS_SEL, '1fad948c');
{
  const dummy = '11'.repeat(65);
  const owner = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const op = {
    sender: owner,
    nonce: 0n,
    initCode: '0x',
    callData: encodeExecute('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 1n, '0x'),
    callGasLimit: 200000n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
    maxFeePerGas: 10n ** 9n,
    maxPriorityFeePerGas: 10n ** 9n,
    paymasterAndData: '0x',
    signature: packSudoSignature('0x' + dummy),
  };
  eq(
    'encodeGetUserOpHash',
    encodeGetUserOpHash(op),
    '0xa61935310000000000000000000000000000000000000000000000000000000000000020000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000493e00000000000000000000000000000000000000000000000000000000000013880000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a451945447000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045000000001111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000'
  );
  eq(
    'encodeHandleOps',
    encodeHandleOps(op, owner),
    '0x1fad948c0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb9226600000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb922660000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000493e00000000000000000000000000000000000000000000000000000000000013880000000000000000000000000000000000000000000000000000000003b9aca00000000000000000000000000000000000000000000000000000000003b9aca0000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a451945447000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045000000001111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000'
  );
}

{
  const host = '0x1111111111111111111111111111111111111111';
  const gw = pageHostFromLocation({ hostname: `${host}.1.w3link.io` });
  eq('pageHost w3link', gw && gw.addr, host);
  eq('pageHost w3link chain', String(gw && gw.chain), '1');
  const base = pageHostFromLocation({ hostname: `${host}.8453.w3eth.io` });
  eq('pageHost w3eth base', String(base && base.chain), '8453');
  const w3 = pageHostFromLocation({ protocol: 'web3:', host: host, pathname: '/' });
  eq('pageHost web3', w3 && w3.addr, host);
  const pin = pageHostFromLocation({ hostname: '127.0.0.1' }, host);
  eq('pageHost pinned', pin && pin.addr, host);
  if (pageHostFromLocation({ hostname: '127.0.0.1' })) {
    console.error('FAIL pageHost localhost must be empty until PAGE_HOST');
    process.exit(1);
  }
}

eq(
  'encodeExecute',
  encodeExecute('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 10n ** 18n, '0x'),
  '0x51945447000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
);

eq(
  'encodeExecuteBatch',
  encodeExecuteBatch([
    {
      to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      value: 0n,
      data: encodeTransfer('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 1n),
    },
  ]),
  '0x34fcd5be000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000'
);

eq(
  'encodeWithdrawTo',
  encodeWithdrawTo('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 1n),
  '0x205c2878000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000001'
);

const dummy = '11'.repeat(65);
eq('sudo prefix', packSudoSignature('0x' + dummy).slice(0, 10), '0x00000000');

if (parseAmt('1.5', 6) !== 1500000n || parseAmt('1000', 6) !== 1000000000n || parseAmt('.5', 18) !== 5n * 10n ** 17n) {
  console.error('FAIL parseAmt');
  process.exit(1);
}
try {
  parseAmt('1.1234567', 6);
  console.error('FAIL parseAmt must reject extra decimals');
  process.exit(1);
} catch {
  /* ok */
}

const p = requiredPrefund(200000n, 200000n, 50000n, 10n ** 9n);
if (nativeOutValue(p, p) !== 0n) {
  console.error('FAIL nativeOut when eth == prefund');
  process.exit(1);
}
if (nativeOutValue(10n ** 18n, p) >= 10n ** 18n - p) {
  console.error('FAIL nativeOut must be < balance - prefund');
  process.exit(1);
}
if (nativeOutValue(p + 10n ** 14n, p) !== 0n) {
  console.error('FAIL nativeOut must reserve Kernel prefund (deposit cannot cover execute value)');
  process.exit(1);
}
if (epOutValue(p, p) !== 0n) {
  console.error('FAIL epOut when deposit == prefund');
  process.exit(1);
}
if (epOutValue(p + 5n, p) !== 5n) {
  console.error('FAIL epOut must subtract locked prefund');
  process.exit(1);
}
if (missingPrefund(0n, 0n, 0n, 0n, p) !== 'prefund') {
  console.error('FAIL missingPrefund token-only with empty Kernel');
  process.exit(1);
}
if (missingPrefund(0n, p, 0n, 0n, p) !== '') {
  console.error('FAIL missingPrefund deposit covers token-only');
  process.exit(1);
}
if (missingPrefund(p, 0n, 0n, 0n, p) !== '') {
  console.error('FAIL missingPrefund Kernel ETH covers token-only');
  process.exit(1);
}
if (missingPrefund(p, 0n, 1n, 0n, p) !== 'eth') {
  console.error('FAIL missingPrefund native after paying prefund from Kernel');
  process.exit(1);
}
if (missingPrefund(0n, p, 0n, 1n, p) !== 'ep') {
  console.error('FAIL missingPrefund deposit withdraw after locked prefund');
  process.exit(1);
}
{
  const L = '0x1111111111111111111111111111111111111111';
  const O = '0x2222222222222222222222222222222222222222';
  const code = '0x6000';
  let r = pickAccount({ legacyAddr: L, legacyCode: code, factoryOnChain: true, ourAddr: O, ourCode: '0x' });
  if (r.aa !== L || r.source !== 'legacy' || !r.deployed) {
    console.error('FAIL pickAccount prefers deployed legacy');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: '0x',
    factoryOnChain: true,
    ourAddr: O,
    ourCode: code,
  });
  if (r.aa !== O || r.source !== 'ours' || !r.deployed) {
    console.error('FAIL pickAccount uses deployed page factory');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: '0x',
    legacyEth: 1n,
    factoryOnChain: true,
    ourAddr: O,
    ourCode: '0x',
  });
  if (r.aa !== L || !r.rescue || r.deployed) {
    console.error('FAIL pickAccount rescues funded legacy');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: '0x',
    factoryOnChain: true,
    ourAddr: O,
    ourCode: '0x',
  });
  if (r.aa !== O || r.source !== 'ours' || r.deployed || r.rescue) {
    console.error('FAIL pickAccount new account on page factory');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: '0x',
    factoryOnChain: false,
    ourAddr: '',
    ourCode: '0x',
  });
  if (r.aa || !r.factoryMissing) {
    console.error('FAIL pickAccount empty when factory missing');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: code,
    legacyEth: 1n,
    factoryOnChain: true,
    ourAddr: O,
    ourCode: code,
    ourEth: 10n,
    ourDeposit: 0n,
  });
  if (r.aa !== O || r.source !== 'ours' || r.legacyStranded || r.altAa !== L || r.altSource !== 'legacy') {
    console.error('FAIL pickAccount both deployed prefers richer ours');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: code,
    factoryOnChain: true,
    ourAddr: O,
    ourCode: code,
  });
  if (r.aa !== L || r.source !== 'legacy' || r.altAa !== O || r.altSource !== 'ours') {
    console.error('FAIL pickAccount both deployed tie uses legacy');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: code,
    legacyEth: 1n,
    factoryOnChain: true,
    ourAddr: O,
    ourCode: code,
    ourEth: 10n,
    prefer: 'legacy',
  });
  if (r.aa !== L || r.source !== 'legacy' || r.altAa !== O) {
    console.error('FAIL pickAccount prefer legacy when ours is richer');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: '0x',
    legacyEth: 5n,
    factoryOnChain: true,
    ourAddr: O,
    ourCode: code,
    ourEth: 1n,
    prefer: 'legacy',
  });
  if (r.aa !== O || r.source !== 'ours' || !r.legacyStranded || r.altAa) {
    console.error('FAIL pickAccount prefer ignored when older has no code');
    process.exit(1);
  }
  r = pickAccount({
    legacyAddr: L,
    legacyCode: '0x',
    legacyEth: 5n,
    factoryOnChain: true,
    ourAddr: O,
    ourCode: code,
    ourEth: 1n,
  });
  if (r.aa !== O || r.source !== 'ours' || !r.legacyStranded) {
    console.error('FAIL pickAccount ours deployed + funded empty legacy is stranded');
    process.exit(1);
  }
  if (classifyHandleOpsRevert('AA21 didn\'t pay prefund') !== 'prefund') {
    console.error('FAIL classifyHandleOpsRevert AA21');
    process.exit(1);
  }
  if (classifyHandleOpsRevert('AA24 signature error') !== 'sig' || classifyHandleOpsRevert('AA23 reverted (or OOG)') !== 'other') {
    console.error('FAIL classifyHandleOpsRevert must treat AA24 as sig and AA23 as other');
    process.exit(1);
  }
  if (hasCode('0x') || hasCode('0x0') || !hasCode('0x6000')) {
    console.error('FAIL hasCode');
    process.exit(1);
  }
  eq('accountFromWord', accountFromWord('0x' + '0'.repeat(24) + L.slice(2)), L);
}

if (isAddress(undefined) || isAddress(null) || isAddress(1) || isAddress('')) {
  console.error('FAIL isAddress must reject missing or non-hex values');
  process.exit(1);
}

const aa = '0xb2358b064f5ea10543cf8034c8576b2e6bfd3be3';
if (!isBlockedDest(ZERO_ADDR, aa) || !isBlockedDest(ETH_PLACEHOLDER, aa) || !isBlockedDest(aa, aa)) {
  console.error('FAIL isBlockedDest must reject zero, ETH placeholder, and the account');
  process.exit(1);
}
if (isBlockedDest('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', aa)) {
  console.error('FAIL isBlockedDest must allow a normal dest');
  process.exit(1);
}

if (TRANSFER_TOPIC !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
  console.error(`FAIL TRANSFER_TOPIC\n got ${TRANSFER_TOPIC}`);
  process.exit(1);
}
eq(
  'topicAddress',
  topicAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  '0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266'
);

eq(
  'parseRpcJson result',
  parseRpcJson('{"jsonrpc":"2.0","id":1,"result":"0x1"}').result,
  '0x1'
);
try {
  parseRpcJson('<!DOCTYPE html><html></html>');
  console.error('FAIL parseRpcJson must reject HTML');
  process.exit(1);
} catch (e) {
  if (!/web page instead of chain data/i.test(e.message || '')) {
    console.error('FAIL parseRpcJson HTML message\n', e.message);
    process.exit(1);
  }
}

eq('userOp topic', USER_OP_TOPIC, '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f');
eq('withdrawn topic', WITHDRAWN_TOPIC, '0xd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb');
eq('received topic', RECEIVED_TOPIC, '0x88a5966d370b9919b20f3e2c13ff65706f196a4e32cc2c12bf57088f88525874');
eq('transfer topic', TRANSFER_TOPIC, '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
{
  const u = parseUserOpEventData('0x' + '7'.padStart(64, '0') + '1'.padStart(64, '0') + '3e8'.padStart(64, '0') + '5208'.padStart(64, '0'));
  if (!u || u.nonce !== 7n || u.ok !== true || u.gasCost !== 1000n || u.gasUsed !== 21000n) {
    console.error('FAIL parseUserOpEventData');
    process.exit(1);
  }
  const w = parseWithdrawnData('0x' + 'd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'.toLowerCase().padStart(64, '0') + '1'.padStart(64, '0'));
  if (!w || w.to !== '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' || w.amount !== 1n) {
    console.error('FAIL parseWithdrawnData');
    process.exit(1);
  }
  const r = parseReceivedData('0x' + 'd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'.toLowerCase().padStart(64, '0') + '1'.padStart(64, '0'));
  if (!r || r.from !== '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' || r.amount !== 1n) {
    console.error('FAIL parseReceivedData');
    process.exit(1);
  }
  eq('logTopicAddr', logTopicAddr(topicAddress(aa)), aa);
}

const here = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(here, 'SKILL.md'))) {
  console.error('FAIL SKILL.md must live at repo root, not onchain-ui/');
  process.exit(1);
}
const skill = readFileSync(join(here, '..', 'SKILL.md'), 'utf8');
if (!skill.trimStart().startsWith('---') || !skill.includes('name: blacksmith-v1-wallet')) {
  console.error('FAIL SKILL.md frontmatter');
  process.exit(1);
}
{
  const page = readFileSync(join(here, 'app.mjs'), 'utf8')
    + readFileSync(join(here, 'index.html'), 'utf8');
  if (/chainlist\.org\/rpcs\.json/i.test(page)) {
    console.error('FAIL page must not fetch Chainlist rpcs.json');
    process.exit(1);
  }
  if (/bun-pin/.test(page)) {
    console.error('FAIL page bundle must not import bun-pin');
    process.exit(1);
  }
}
for (const a of [ENTRY_POINT, KERNEL_FACTORY, ACCOUNT_FACTORY, KERNEL_IMPL, ECDSA_VALIDATOR]) {
  if (!skill.includes(a)) {
    console.error('FAIL SKILL.md missing', a);
    process.exit(1);
  }
}
if (!skill.includes('Kernel `Received`') || !skill.includes('cap 256') || !skill.includes('createAccount')) {
  console.error('FAIL SKILL.md Activity must name Received and cap 256');
  process.exit(1);
}
if (/zerodev/i.test(skill)) {
  console.error('FAIL SKILL.md must not name ZeroDev');
  process.exit(1);
}
if (!skill.includes('this page’s factory') || !skill.includes('Legacy factory')) {
  console.error('FAIL SKILL.md must name both factories');
  process.exit(1);
}
if (!skill.includes('eth_call') || !skill.includes('handleOps')) {
  console.error('FAIL SKILL.md must simulate handleOps');
  process.exit(1);
}
{
  const html = renderMd(skill);
  if (!html.includes('<h1>') || !html.includes('<ol>') || !html.includes('<code>') || !html.includes('blacksmith-v1-wallet')) {
    console.error('FAIL renderMd');
    process.exit(1);
  }
  const eoa = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const aa = '0xb2358b064f5ea10543cf8034c8576b2e6bfd3be3';
  if (fillSkill(skill).includes('(connected account)') || fillSkill(skill).includes('not found')) {
    console.error('FAIL fillSkill must leave placeholders when disconnected');
    process.exit(1);
  }
  const connected = fillSkill(skill, { eoa });
  if (!connected.includes(`${eoa} (connected account)`) || !connected.includes('not found (derived from connected)')) {
    console.error('FAIL fillSkill connected without AA');
    process.exit(1);
  }
  const ghost = fillSkill(skill, { eoa, aa, deployed: false });
  if (!ghost.includes(`${aa} (derived from connected; no account on this network)`)) {
    console.error('FAIL fillSkill undeployed AA');
    process.exit(1);
  }
  const live = fillSkill(skill, { eoa, aa, deployed: true });
  if (!live.includes(`${aa} (derived from connected)`) || live.includes('no account on this network') || live.includes('YOUR_')) {
    console.error('FAIL fillSkill deployed AA');
    process.exit(1);
  }
}

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'index.html'), 'utf8');
const cssPath = join(dir, 'wallet.css');
const skin = page + (existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '');
for (const s of [
  'id="theme"',
  'v1w-theme',
  ':root[data-theme="light"]',
  '--well:',
  '--ring:',
  '--wl:',
  '--bp:',
  '--in:',
  '--up:',
  '--sb:',
  'viewBox="0 0 345 345"',
  'fill="#F5B554"',
  'href="./favicon.svg"',
  'id="destMe"',
  'Use connected wallet',
  'Custom RPC',
  'id="rpcAdd"',
  'id="rpcIn"',
  'Prepaid gas',
  'id="hist"',
  'id="histFork"',
  'hist-ttl',
  'tok-meta',
  'id="epAddr"',
  'id="tokAll"',
  'id="tokAdd"',
  'id="tokenIn"',
  'id="tokMore"',
  'Scan further',
  'Custom token',
  'tok-open',
  'id="i-ext"',
  'id="i-copy"',
  'id="i-ok"',
  'body:not(.on) :is(.net, .tabs, .panel-wallet, .act, .dock, #rpcAdd, #rpcBox)',
  '#hdrActions #connect',
  'id="connectLand"',
  'body:not(.on):not([data-tab="skill"]) #connect',
  'body:not(.on)[data-tab="skill"] {\n      width: min(100%, 48rem);',
  'height: calc(var(--s4) + var(--s1) * 2)',
  'id="skillOpen"',
  'id="skillBack"',
  'id="tab-skill"',
  'id="panel-skill"',
  'id="skillView"',
  'Lasting on-chain-capable smart account UI',
  'Your smart account',
  'id="go"',
  'id="create"',
  'create it once',
  'The smart account also needs ETH or prepaid gas',
  'Built to keep using',
  'stored on-chain at',
  'Save this page',
  'id="hostSave"',
  'id="hostGwBase"',
  'Blacksmith never had the keys',
  'id="pageHost"',
  'id="hostLive"',
  'id="connectLand"',
  'id="skillHint"',
  'id="askList"',
  'position: fixed',
  'margin: 0 auto',
  'width: min(100%, var(--page))',
  'width: min(100%, 40rem)',
  'min-width: 64rem',
  '--page: 72rem',
  'button:active:not(:disabled):not(.quiet)',
  'class="quiet"',
  'class="ask-sum',
]) {
  if (!skin.includes(s)) {
    console.error('FAIL page/css missing', s);
    process.exit(1);
  }
}
for (const s of ['Free send page', 'EntryPoint deposit', 'Add prepaid gas', 'id="amtDep"', 'Add one in Setup', 'id="tab-setup"', '>Setup</button>', 'does not create a new account', '<summary>', '<details', 'cast call HOST']) {
  if (page.includes(s)) {
    console.error('FAIL index.html must not contain', s);
    process.exit(1);
  }
}

if (HIST_CAP !== 256 || HIST_V !== 2 || HIST_TS !== 24) {
  console.error('FAIL HIST_CAP/V/TS');
  process.exit(1);
}
{
  // Deep-receipts probed 2026-09-17: every URL served unaddressed 2023 Transfer logs.
  const want = {
    1: [
      'https://gateway.tenderly.co/public/mainnet',
      'https://ethereum-public.nodies.app',
      'https://ethereum.public.blockpi.network/v1/rpc/public',
      'https://mainnet.rpc.sentio.xyz',
      'https://eth.api.pocket.network',
    ],
    8453: [
      'https://base.rpc.sentio.xyz',
      'https://base-public.nodies.app',
      'https://base-mainnet.public.blastapi.io',
      'https://mainnet.base.org',
      'https://gateway.tenderly.co/public/base',
    ],
  };
  for (const id of [1, 8453]) {
    const got = CHAINS[id]?.rpcs || [];
    if (got.length !== want[id].length || got.some((u, i) => u !== want[id][i])) {
      console.error(`FAIL CHAINS[${id}] must pin the keyless Chainlist snapshot in order\n got ${got.join(' ')}`);
      process.exit(1);
    }
  }
}
eq('esc', esc('<x&y>'), '&lt;x&amp;y&gt;');
eq('short', short('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'), '0xf39F…2266');
eq('hex', hex(255), '0xff');
if (word('0x0a') !== 10n || fmtAmt(1500000n, 6) !== '1.5') {
  console.error('FAIL word/fmtAmt');
  process.exit(1);
}
eq('decodeStr packed', decodeStr('0x' + Buffer.from('USDC\0').toString('hex')), 'USDC');
{
  const len = (4).toString(16).padStart(64, '0');
  const off = (32).toString(16).padStart(64, '0');
  const data = Buffer.from('USDC').toString('hex').padEnd(64, '0');
  eq('decodeStr abi', decodeStr('0x' + off + len + data), 'USDC');
}
{
  const logs = {
    ops: [{ blockNumber: '0xa' }, { blockNumber: '0x5' }],
    ins: [{ blockNumber: '0x8' }],
    outs: [],
    wds: [],
    rcv: [{ blockNumber: '0x3' }],
  };
  const kept = logsFrom(logs, 8);
  if (kept.ops.length !== 1 || kept.ins.length !== 1 || kept.rcv.length !== 0) {
    console.error('FAIL logsFrom must drop blocks before from');
    process.exit(1);
  }
  if (logsFrom(null) !== null) {
    console.error('FAIL logsFrom null');
    process.exit(1);
  }
}
setRpcUrl('https://example.invalid', ['https://alt.invalid']);
eq('getRpcUrl', getRpcUrl(), 'https://example.invalid');
eq('getRpcAlts', getRpcAlts().join(','), 'https://alt.invalid');
setRpcUrl('');
if (getRpcAlts().length) {
  console.error('FAIL setRpcUrl clears alts');
  process.exit(1);
}

if (!timeoutLogsMsg('signal timed out') || !timeoutLogsMsg('The operation timed out.') || !timeoutLogsMsg('This operation was aborted')) {
  console.error('FAIL timeoutLogsMsg must catch abort/timeout text');
  process.exit(1);
}
if (timeoutLogsMsg('rate limit') || timeoutLogsMsg('web page instead') || timeoutLogsMsg('')) {
  console.error('FAIL timeoutLogsMsg must not catch rate-limit or fatal text');
  process.exit(1);
}
if (!timeoutLogsMsg(LOGS_TIMEOUT_PUBLIC) || !timeoutLogsMsg(LOGS_TIMEOUT_CUSTOM)) {
  console.error('FAIL friendly timeout copy must classify as timeout (no double Custom RPC suffix)');
  process.exit(1);
}
{
  const realFetch = globalThis.fetch;
  const res = (result) => ({ ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
  const log = { blockNumber: '0xa', transactionHash: '0x' + 'ab'.repeat(32), address: '0x' + '11'.repeat(20), topics: [], data: '0x' };
  const timeoutErr = () => new DOMException('signal timed out', 'TimeoutError');
  const abortErr = () => new DOMException('The operation was aborted', 'AbortError');
  let hits = [];
  const stub = (fn) => {
    hits = [];
    globalThis.fetch = async (u) => {
      hits.push(u);
      return fn(u);
    };
  };
  try {
    // A timed-out public URL fails over to the next one (was fatal: "signal timed out").
    stub((u) => {
      if (u === 'https://one.invalid') throw timeoutErr();
      return res([log]);
    });
    setRpcUrl('https://one.invalid', ['https://two.invalid']);
    const got = await getLogs(10, 20, [TRANSFER_TOPIC]);
    // jrpc retries the stalled URL once, then the page fails over.
    if (got.length !== 1 || hits.join(' ') !== 'https://one.invalid https://one.invalid https://two.invalid') {
      console.error('FAIL getLogs must treat a timeout as retryable and fail over', hits);
      process.exit(1);
    }
    // AbortError (no timeout text) is retryable too, and the answering URL leads later pages.
    stub((u) => {
      if (u === 'https://one.invalid') throw abortErr();
      return res([log]);
    });
    const wide = await getLogs(10, 10 + LOGS_RANGE_MAX + 1, [TRANSFER_TOPIC]);
    if (wide.length !== 2 || hits.filter((u) => u === 'https://one.invalid').length !== 2 || hits[hits.length - 1] !== 'https://two.invalid') {
      console.error('FAIL getLogs must retry aborts and promote the answering URL for later pages', hits);
      process.exit(1);
    }
    // Every public path stalling surfaces the Custom RPC pointer, never raw "signal timed out".
    stub(() => {
      throw timeoutErr();
    });
    let msg = '';
    try {
      await getLogs(10, 20, [TRANSFER_TOPIC]);
    } catch (e) {
      msg = e.message || '';
    }
    if (msg !== LOGS_TIMEOUT_PUBLIC || /signal timed out/i.test(msg)) {
      console.error('FAIL all-stall public scan must show the Custom RPC pointer\n got', msg);
      process.exit(1);
    }
    // Custom RPC is exclusive: one URL, its own timeout copy, no public fall-through.
    stub(() => {
      throw timeoutErr();
    });
    setRpcUrl('https://custom.invalid', []);
    msg = '';
    try {
      await getLogs(10, 20, [TRANSFER_TOPIC]);
    } catch (e) {
      msg = e.message || '';
    }
    // One retry on the exclusive custom URL, never a public fall-through.
    if (msg !== LOGS_TIMEOUT_CUSTOM || hits.length !== 2 || hits[0] !== 'https://custom.invalid') {
      console.error('FAIL custom RPC timeout must not fall through to public\n got', msg, hits);
      process.exit(1);
    }
    // Fatal replies still refuse failover.
    stub((u) => (u === 'https://one.invalid' ? { ok: true, text: async () => '<!DOCTYPE html>' } : res([log])));
    setRpcUrl('https://one.invalid', ['https://two.invalid']);
    msg = '';
    try {
      await getLogs(10, 20, [TRANSFER_TOPIC]);
    } catch (e) {
      msg = e.message || '';
    }
    if (!/web page instead/i.test(msg) || hits.length !== 1) {
      console.error('FAIL fatal getLogs errors must not fail over', msg, hits);
      process.exit(1);
    }
  } finally {
    globalThis.fetch = realFetch;
    setRpcUrl('');
  }
}

if (!unservedLogsMsg('pruned history unavailable') || !unservedLogsMsg('method not available')) {
  console.error('FAIL unservedLogsMsg must catch prune walls and dropped methods');
  process.exit(1);
}
if (unservedLogsMsg('signal timed out') || unservedLogsMsg('rate limit') || unservedLogsMsg('')) {
  console.error('FAIL unservedLogsMsg must not catch stalls or transient text');
  process.exit(1);
}

{
  // Token discovery walk: no LOGS_LOOKBACK ceiling, newest page first, soft budget, wall marker.
  const realFetch = globalThis.fetch;
  const AA2 = '0x' + '22'.repeat(20);
  const pad2 = topicAddress(AA2);
  const tokAddr = '0x' + '33'.repeat(20);
  const oldLog = {
    blockNumber: '0x64',
    transactionHash: '0x' + 'cd'.repeat(32),
    address: tokAddr,
    topics: [TRANSFER_TOPIC, '0x' + '00'.repeat(32), pad2],
    data: '0x' + '1'.padStart(64, '0'),
  };
  const res = (result) => ({ ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
  const LATEST = 250000; // more than 2 × LOGS_LOOKBACK
  const budget = (pages, ms) => ({ pages, ms, t0: Date.now(), used: 0 });
  try {
    let calls = [];
    globalThis.fetch = async (u, init) => {
      const body = JSON.parse(init.body);
      if (body.method !== 'eth_getLogs') return res('0x0');
      const q = body.params[0];
      const from = parseInt(q.fromBlock, 16);
      const to = parseInt(q.toBlock, 16);
      calls.push([from, to]);
      const hit = from <= 100 && to >= 100 && (q.topics || [])[2] === pad2 && !q.address;
      return res(hit ? [oldLog] : []);
    };
    setRpcUrl('https://deep.invalid', []);
    // Birth-era receive is outside the Activity lookback: the walk must still reach it.
    const pages = [];
    const walk = await walkTransfersIn(1, LATEST, AA2, {
      budget: budget(100, 60000),
      descend: true,
      onPage: (logs, a, b) => pages.push([a, b]),
    });
    if (!walk.done || walk.stopped) {
      console.error('FAIL deep walk must complete inside a generous budget', walk.stopped);
      process.exit(1);
    }
    if (pages.length !== 25 || pages[0][0] !== 240001 || pages[0][1] !== LATEST || pages[24][0] !== 1) {
      console.error('FAIL deep walk must page newest-first down to birth', pages[0], pages[pages.length - 1], pages.length);
      process.exit(1);
    }
    if (!walk.logs.some((l) => String(l.address).toLowerCase() === tokAddr && Number(l.blockNumber) === 100)) {
      console.error('FAIL deep walk must surface the birth-era Transfer-in');
      process.exit(1);
    }
    if (calls.some(([from]) => from < 1) || !calls.some(([from]) => from < LATEST - LOGS_LOOKBACK)) {
      console.error('FAIL deep walk must not be clipped to the Activity lookback');
      process.exit(1);
    }
    // The same node, same account: Activity (scanAccountLogs) stays inside the recent window.
    calls = [];
    const pack = await scanAccountLogs(1, LATEST, AA2);
    if (!pack.clipped) {
      console.error('FAIL scanAccountLogs must still clip to LOGS_LOOKBACK');
      process.exit(1);
    }
    if (calls.some(([from]) => from < LATEST - LOGS_LOOKBACK)) {
      console.error('FAIL Activity scan must not walk below the recent window');
      process.exit(1);
    }
    if (pack.ins.length !== 0) {
      console.error('FAIL lookback-only Activity scan must miss the birth-era receive (walk covers it)');
      process.exit(1);
    }
    // Page budget stops newest-first and reports early-of-birth instead of hanging.
    const pages2 = [];
    const w2 = await walkTransfersIn(1, LATEST, AA2, {
      budget: budget(3, 60000),
      descend: true,
      onPage: (logs, a, b) => pages2.push([a, b]),
    });
    if (w2.done || w2.stopped !== 'pages' || pages2.length !== 3 || pages2[2][1] !== 230000) {
      console.error('FAIL walk page budget must stop after 3 newest pages', w2.stopped, pages2.length);
      process.exit(1);
    }
    // Time budget stops before the first page when it is already spent.
    const w3 = await walkTransfersIn(1, LATEST, AA2, { budget: { pages: 100, ms: 0, t0: Date.now() - 1, used: 0 }, descend: true });
    if (w3.done || w3.stopped !== 'ms' || w3.logs.length !== 0) {
      console.error('FAIL walk time budget must stop a slow scan', w3.stopped);
      process.exit(1);
    }
    // A dead session halts the walk without another page.
    const w4 = await walkTransfersIn(1, LATEST, AA2, { budget: budget(100, 60000), descend: true, live: () => false });
    if (w4.done || w4.stopped !== 'halt') {
      console.error('FAIL walk must halt when the session is stale', w4.stopped);
      process.exit(1);
    }
    // Every node refusing the range is a wall (unserved), never a timeout pointer.
    globalThis.fetch = async () => {
      throw new Error('pruned history unavailable');
    };
    let err = null;
    try {
      await walkTransfersIn(1, 50000, AA2, { budget: budget(5, 60000), descend: true });
    } catch (e) {
      err = e;
    }
    if (!err || !err.unserved || !/pruned history/i.test(err.message || '')) {
      console.error('FAIL all-refused walk must throw the range error marked unserved', err && err.message);
      process.exit(1);
    }
    // A stall mixed with a refusal is transient: timeout pointer, no wall marker.
    setRpcUrl('https://deep.invalid', ['https://stall.invalid']);
    globalThis.fetch = async (u) => {
      if (u === 'https://stall.invalid') throw new DOMException('signal timed out', 'TimeoutError');
      throw new Error('pruned history unavailable');
    };
    err = null;
    try {
      await walkTransfersIn(1, 50000, AA2, { budget: budget(5, 60000), descend: true });
    } catch (e) {
      err = e;
    }
    if (!err || err.message !== LOGS_TIMEOUT_PUBLIC || err.unserved) {
      console.error('FAIL stall+refusal must stay the Custom RPC pointer, not a wall', err && err.message);
      process.exit(1);
    }
  } finally {
    globalThis.fetch = realFetch;
    setRpcUrl('');
  }
}
if (TOK_WALK_PUBLIC.pages >= TOK_WALK_CUSTOM.pages || TOK_WALK_PUBLIC.passes >= TOK_WALK_CUSTOM.passes) {
  console.error('FAIL custom/archive token walk must out-budget the public one');
  process.exit(1);
}
if (PAGE_HOST !== '') {
  console.error('FAIL PAGE_HOST must stay empty until an operator broadcasts');
  process.exit(1);
}
setPendingTx('0xabc');
eq('pending', getPendingTx(), '0xabc');
forgetPendingTx();
if (getPendingTx()) {
  console.error('FAIL forgetPendingTx');
  process.exit(1);
}
eq('sendFail msg', sendFail(new Error('nope')), 'nope');
if (!/try again/i.test(sendFail(null))) {
  console.error('FAIL sendFail fallback');
  process.exit(1);
}

const app = readFileSync(join(dir, 'app.mjs'), 'utf8');
const rpcSrc = readFileSync(join(dir, 'rpc.mjs'), 'utf8');
if (!app.includes('kernelExecImpl') || !app.includes('kernelBatchImpl')) {
  console.error('FAIL reconnect must allow known 0.2.x execute impls');
  process.exit(1);
}
if (!app.includes('logs?.clipped') || !app.includes('Showing recent history')) {
  console.error('FAIL public log failover and recent-history copy');
  process.exit(1);
}
if (!app.includes('discoverMajors') || !app.includes('backfillHist') || !page.includes('id="histMore"')) {
  console.error('FAIL majors probe and Scan further backfill must be wired');
  process.exit(1);
}
if (!rpcSrc.includes('pruneFloor') || !rpcSrc.includes('rpcHasDeepLogs') || !rpcSrc.includes('scanRangeLogs')) {
  console.error('FAIL rpc must clamp pruning floors and prefer deep-receipts nodes');
  process.exit(1);
}
{
  const hist = readFileSync(join(dir, 'history.mjs'), 'utf8');
  if (!hist.includes('mergeQ') || !/pushHist[\s\S]*?mergeQ = mergeQ/.test(hist)) {
    console.error('FAIL history merges and pushHist must serialize through mergeQ');
    process.exit(1);
  }
  const pruneCopies = (app.match(/keeps recent history only/g) || []).length + (hist.match(/keeps recent history only/g) || []).length;
  if (pruneCopies > 0 || !rpcSrc.includes('PRUNE_HINT')) {
    console.error('FAIL pruning toast copy must live once in rpc.mjs as PRUNE_HINT');
    process.exit(1);
  }
}
if (app.includes('No recent token transfers') || app.includes('No recent activity on this node') || app.includes('add a token by address')) {
  console.error('FAIL clip copy must be one toast, not empty-state duplicates');
  process.exit(1);
}
if (!rpcSrc.includes('chooseRpc') || !rpcSrc.includes('topics: [TRANSFER_TOPIC]') || !rpcSrc.includes('for (const u of publics)')) {
  console.error('FAIL chooseRpc must probe unaddressed eth_getLogs on public URLs in order');
  process.exit(1);
}
if (rpcSrc.includes('to - 64') || rpcSrc.includes('recentLogsFrom') || rpcSrc.includes('logsClipped')) {
  console.error('FAIL logs must not lag-64, half-window clip, or module clipped flag');
  process.exit(1);
}
if (!app.includes('maxPicks') || !app.includes('This account sends one asset at a time.')) {
  console.error('FAIL 0.2.1 must not Select-all batch');
  process.exit(1);
}
if (app.includes('bits.push(SEND_ONE)') || !app.includes('if (bumped) setStatus(SEND_ONE)')) {
  console.error('FAIL one-asset note must be progressive disclosure on batch attempt, not a banner');
  process.exit(1);
}
if (app.includes("empty.textContent = tokens.length ? '' : hint")) {
  console.error('FAIL token empty state must not duplicate the toast error');
  process.exit(1);
}
if (!app.includes('accountNote')) {
  console.error('FAIL aa notes must compose stranded with execute-only');
  process.exit(1);
}
if (!app.includes('latest - LOGS_LOOKBACK')) {
  console.error('FAIL birth fallback must stay inside public-node log window');
  process.exit(1);
}
if (!app.includes('walkTransfersIn') || app.includes('scan.logs.ins')) {
  console.error('FAIL token discovery must walk Transfer-ins itself, not read the clipped Activity scan');
  process.exit(1);
}
{
  const scanFn = rpcSrc.slice(rpcSrc.indexOf('async function scanLogs'), rpcSrc.indexOf('TOK_WALK_PUBLIC'));
  if (!scanFn.includes('descend') || /LOGS_LOOKBACK/.test(scanFn)) {
    console.error('FAIL the token walk must page newest-first without the Activity lookback ceiling');
    process.exit(1);
  }
}
if (!app.includes('Scanned back to block') || !app.includes('Scanning older transfers…')) {
  console.error('FAIL budgeted token scan must say so while scanning and where it stopped');
  process.exit(1);
}
if (!app.includes('Public nodes can’t serve this account’s older blocks')) {
  console.error('FAIL prune-wall hint must point at paste / Custom RPC');
  process.exit(1);
}
{
  const at = app.indexOf('No tokens on this account yet.');
  if (at < 0 || !app.slice(Math.max(0, at - 400), at).includes("state === 'done'")) {
    console.error('FAIL “No tokens yet” must be gated on a completed scan, never a clipped one');
    process.exit(1);
  }
}
if (app.includes('Promise.any') || rpcSrc.includes('Promise.any')) {
  console.error('FAIL pickRpc must walk CHAINS URLs in order, not Promise.any');
  process.exit(1);
}
if (!/await pickRpc[\s\S]{0,240}chainId = id/.test(app) || /chainId = id[\s\S]{0,240}await pickRpc/.test(app)) {
  console.error('FAIL switchChain must await pickRpc before assigning chainId');
  process.exit(1);
}
if (!/async function connect\(\)[\s\S]{0,900}isAddress\(next\)[\s\S]{0,400}fillDestMe/.test(app)) {
  console.error('FAIL connect() must reject a non-address and prefill dest via fillDestMe');
  process.exit(1);
}
if (/function placeConnect\(\)[\s\S]{0,120}appendChild/.test(app)) {
  console.error('FAIL placeConnect must not move #connect');
  process.exit(1);
}
if (!app.includes('Falling through to public')) {
  console.error('FAIL custom RPC must not fall through to public');
  process.exit(1);
}
if (app.includes('if (!live() || scan.fork) return') || app.includes('logs: null')) {
  console.error('FAIL Activity must read logs on the local fork');
  process.exit(1);
}
if (app.includes("$('openAa').hidden") || app.includes('link.hidden = !ok || fork')) {
  console.error('FAIL explorer control must stay visible when unavailable');
  process.exit(1);
}
{
  const send = readFileSync(join(dir, 'send.mjs'), 'utf8');
  if (app.includes('fmtFill') || app.includes('skip: true') || send.includes('fmtFill') || send.includes('skip: true')) {
    console.error('FAIL leftover fmtFill or pickAmt skip sentinel');
    process.exit(1);
  }
}
if (!readFileSync(join(dir, 'build.mjs'), 'utf8').includes("n !== 'host'")) {
  console.error('FAIL class mangler must not rename loc.host');
  process.exit(1);
}
{
  const icon = readFileSync(join(dir, 'favicon.svg'), 'utf8');
  if ((icon.match(/<path\b/g) || []).length !== 10 || !icon.includes('viewBox="0 0 345 345"')) {
    console.error('FAIL favicon.svg must be the header mark');
    process.exit(1);
  }
  if (!readFileSync(join(dir, 'build.mjs'), 'utf8').includes('encodeURIComponent(icon)')) {
    console.error('FAIL freeze must inline favicon as data URI');
    process.exit(1);
  }
}
if (!readFileSync(join(dir, 'build.mjs'), 'utf8').includes('chunk') || !readFileSync(join(dir, 'build.mjs'), 'utf8').includes('0xEF')) {
  console.error('FAIL build.mjs must reject 0xEF at each chunk start');
  process.exit(1);
}
{
  const send = readFileSync(join(dir, 'send.mjs'), 'utf8');
  if (!send.includes('eth_call') || !send.includes('ACCOUNT_FACTORY')) {
    console.error('FAIL send must simulate handleOps and create on this page’s factory');
    process.exit(1);
  }
  if (!send.includes('classifyHandleOpsRevert') || send.includes("sim.kind !== 'prefund'") || !send.includes("sim.kind === 'sig'")) {
    console.error('FAIL send must retry eth_sign only on AA24 / signature miss');
    process.exit(1);
  }
  if (send.includes('!eq(S.eoa(), eoa) || !eq(S.aa(), aa)')) {
    console.error('FAIL stranded create must not require S.aa() === created address');
    process.exit(1);
  }
  if (send.includes('preferSource')) {
    console.error('FAIL stranded create must not session-switch after create');
    process.exit(1);
  }
}
if (!app.includes('Create older account') || !app.includes('legacyStranded') || !app.includes('aaAct')) {
  console.error('FAIL app must surface stranded older create off the send dock');
  process.exit(1);
}
if (app.includes('Use older account') || app.includes('Use this page’s account') || app.includes('v1w-aa-') || app.includes('preferSource')) {
  console.error('FAIL app must not teach a two-account switcher');
  process.exit(1);
}
if (!skill.includes('two accounts') || !skill.includes('older account') || !skill.includes('do not switch')) {
  console.error('FAIL SKILL.md must document two-account rescue without a send-path switch');
  process.exit(1);
}
if (!skill.includes('AA24') || /On AA23 /.test(skill)) {
  console.error('FAIL SKILL.md must retry eth_sign on AA24, not AA23');
  process.exit(1);
}
if (!readFileSync(join(dir, 'dev/smoke-fork.mjs'), 'utf8').includes('smoke-walkaway.mjs')) {
  console.error('FAIL fork suite must include smoke-walkaway');
  process.exit(1);
}
if (!readFileSync(join(dir, 'dev/smoke-ui.mjs'), 'utf8').includes('Create older account') || !readFileSync(join(dir, 'dev/smoke-ui.mjs'), 'utf8').includes('aaAct')) {
  console.error('FAIL smoke-ui must drive older-account create from aaAct');
  process.exit(1);
}
if (readFileSync(join(dir, 'dev/smoke-ui.mjs'), 'utf8').includes('Use older account')) {
  console.error('FAIL smoke-ui must not drive a send-dock account switcher');
  process.exit(1);
}

if (/send page/i.test(skill)) {
  console.error('FAIL SKILL.md must not say send page');
  process.exit(1);
}

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist/index.html');
if (existsSync(dist)) {
  const freeze = readFileSync(dist, 'utf8');
  if (freeze.includes('src="./app.mjs"')) {
    console.error('FAIL dist still loads app.mjs — inlining used String.replace $&');
    process.exit(1);
  }
  if (freeze.includes('cast call HOST')) {
    console.error('FAIL dist still has placeholder HOST fetch command');
    process.exit(1);
  }
  if (!freeze.includes('id=hostSave') && !freeze.includes('id="hostSave"')) {
    console.error('FAIL dist missing Save this page');
    process.exit(1);
  }
  if (!/<script type="?module"?>/.test(freeze) || /<script type="?module"? src=/.test(freeze)) {
    console.error('FAIL dist missing inlined module');
    process.exit(1);
  }
  if (!/\.host\s*\|\||\['host'\]|\["host"\]/.test(freeze)) {
    console.error('FAIL dist lost loc.host for web3:// (class mangler?)');
    process.exit(1);
  }
  if (/body:not\(\.on\):is\(/.test(freeze)) {
    console.error('FAIL dist CSS collapsed descendant :is (landing chrome would show disconnected)');
    process.exit(1);
  }
  if (freeze.includes('r2=YOUR_EOA_ADDRESS') || freeze.includes('=0x+')) {
    console.error('FAIL crushHtml ate quotes inside the inlined module');
    process.exit(1);
  }
  const mod = freeze.match(/<script type="?module"?>([\s\S]*)<\/script>/);
  if (!mod) {
    console.error('FAIL dist module extract');
    process.exit(1);
  }
  try {
    new Function(mod[1]);
  } catch (e) {
    console.error('FAIL dist module parse', e.message);
    process.exit(1);
  }
  const logo = freeze.match(/viewBox="0 0 345 345"[\s\S]*?<\/svg>/);
  if (!freeze.includes('r="2.6"') || freeze.includes('r=2.6/') || freeze.includes('r="2.6/"')) {
    console.error('FAIL crushHtml unquoted SVG numbers into r=2.6/> (sun/moon nest)');
    process.exit(1);
  }
  if (!logo || (logo[0].match(/<path\b/g) || []).length !== 10 || (logo[0].match(/\/>/g) || []).length < 10) {
    console.error('FAIL dist SVG paths nested (crush stripped /> )');
    process.exit(1);
  }
}

const wallet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dev/injected-wallet.js'), 'utf8');
if (!wallet.includes('isAnvilFork: !cfg.baseRpc') || !wallet.includes('cfg.baseRpc') || !wallet.includes('baseRpc: cfg.baseRpc')) {
  console.error('FAIL playground wallet stays one chain unless smoke sets baseRpc');
  process.exit(1);
}

{
  const bunFile = join(here, '..', '.bun-version');
  const pinned = existsSync(bunFile) ? readFileSync(bunFile, 'utf8').trim() : '';
  if (pinned !== BUN_PIN) {
    console.error('FAIL .bun-version must be', BUN_PIN);
    process.exit(1);
  }
  const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (bun.status === 0) {
    const v = String(bun.stdout || '').trim();
    if (v !== BUN_PIN) {
      console.error(`FAIL bun ${v} is not freeze pin ${BUN_PIN}`);
      process.exit(1);
    }
  }
}

console.log('ok');
