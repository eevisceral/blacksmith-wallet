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
import { decodeStr, logsFrom, getRpcUrl, setRpcUrl } from './rpc.mjs';
import { HIST_CAP, HIST_V, HIST_TS } from './history.mjs';
import { getPendingTx, setPendingTx, forgetPendingTx, sendFail } from './send.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  'Wallet for your Blacksmith V1 account',
  'Your smart account',
  'id="go"',
  'id="create"',
  'create it once',
  'The smart account also needs ETH or prepaid gas',
  'This page can be stored on Ethereum and Base',
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
if (!CHAINS[1]?.rpcs?.length || !CHAINS[8453]?.rpcs?.length) {
  console.error('FAIL CHAINS must list public RPCs for Ethereum and Base');
  process.exit(1);
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
setRpcUrl('https://example.invalid');
eq('getRpcUrl', getRpcUrl(), 'https://example.invalid');
setRpcUrl('');
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
if (app.includes('Promise.any') || !app.includes('for (const u of CHAINS[id].rpcs)')) {
  console.error('FAIL pickRpc must walk CHAINS[id].rpcs in order, not Promise.any');
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

console.log('ok');
