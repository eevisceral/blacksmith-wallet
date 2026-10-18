#!/usr/bin/env node
/** Fork: permissionless factory, resolve/rescue/stranded, AA21 prefund, simulate-before-send. */
import {
  ACCOUNT_FACTORY,
  ECDSA_VALIDATOR,
  ENTRY_POINT,
  EIP1967_IMPL_SLOT,
  KERNEL_FACTORY,
  KERNEL_IMPL,
  USER_OP_TOPIC,
  encodeBalanceOf,
  encodeCreateAccount,
  encodeExecute,
  encodeFactoryCreate,
  encodeFactoryGetAccount,
  encodeGetAccountAddress,
  encodeGetNonce,
  encodeGetUserOpHash,
  encodeHandleOps,
  encodeIsAllowedImplementation,
  encodeTransfer,
  hasCode,
  missingPrefund,
  packSudoSignature,
  parseUserOpEventData,
  pickAccount,
  requiredPrefund,
} from '../kernel.mjs';
import { ANVIL_EOA, USDC, ensureAccountFactory, jrpc, waitForRpc } from './seed.mjs';

const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545';
const DEST = '0x1111111111111111111111111111111111111111';
const DUMMY65 = '0x' + '11'.repeat(65);
const OWNERS = {
  create: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  rescue: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  aa21: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  strand: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
};

async function takeOwner(used, predFns) {
  const accounts = await jrpc(RPC, 'eth_accounts', []);
  const prefer = [...Object.values(OWNERS), ...accounts];
  const seen = new Set();
  for (const o of prefer) {
    const key = String(o).toLowerCase();
    if (seen.has(key) || eq(o, ANVIL_EOA) || used.has(key)) continue;
    seen.add(key);
    let free = true;
    for (const fn of predFns) {
      const a = await fn(o);
      if (hasCode(await jrpc(RPC, 'eth_getCode', [a, 'latest']))) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    used.add(key);
    return o;
  }
  fail('no unused anvil account — restart node onchain-ui/dev/run.mjs');
}

function fail(reason) {
  console.error('FAIL', reason);
  process.exit(1);
}

function word(h) {
  return BigInt(h && h !== '0x' ? h : '0x0');
}

function addrOf(raw) {
  return '0x' + String(raw).slice(-40);
}

function eq(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

async function waitReceipt(hash) {
  for (let i = 0; i < 40; i++) {
    const r = await jrpc(RPC, 'eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await new Promise((x) => setTimeout(x, 250));
  }
  fail('no receipt ' + hash);
}

async function sendTx(tx) {
  const hash = await jrpc(RPC, 'eth_sendTransaction', [{ gas: '0x200000', ...tx }]);
  const rec = await waitReceipt(hash);
  if (BigInt(rec.status) === 0n) fail('tx reverted ' + hash);
  return rec;
}

async function predictLegacy(owner) {
  return addrOf(await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeGetAccountAddress(owner) }, 'latest']));
}

async function predictOurs(owner, index = 0n) {
  return addrOf(await jrpc(RPC, 'eth_call', [{ to: ACCOUNT_FACTORY, data: encodeFactoryGetAccount(owner, index) }, 'latest']));
}

async function snapshot(owner, prefer) {
  const factoryOnChain = hasCode(await jrpc(RPC, 'eth_getCode', [ACCOUNT_FACTORY, 'latest']));
  const legacyAddr = await predictLegacy(owner);
  const ourAddr = factoryOnChain ? await predictOurs(owner) : '';
  const [legacyCode, legacyEth, legacyDep, ourCode, ourEth, ourDep] = await Promise.all([
    jrpc(RPC, 'eth_getCode', [legacyAddr, 'latest']),
    jrpc(RPC, 'eth_getBalance', [legacyAddr, 'latest']),
    jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeBalanceOf(legacyAddr) }, 'latest']),
    ourAddr ? jrpc(RPC, 'eth_getCode', [ourAddr, 'latest']) : '0x',
    ourAddr ? jrpc(RPC, 'eth_getBalance', [ourAddr, 'latest']) : '0x0',
    ourAddr ? jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeBalanceOf(ourAddr) }, 'latest']) : '0x0',
  ]);
  const picked = pickAccount({
    legacyAddr,
    legacyCode,
    legacyEth: word(legacyEth),
    legacyDeposit: word(legacyDep),
    factoryOnChain,
    ourAddr,
    ourCode,
    ourEth: word(ourEth),
    ourDeposit: word(ourDep),
    prefer,
  });
  return { factoryOnChain, legacyAddr, ourAddr, picked };
}

function buildOp(aa, nonce, callData, nCalls, fees) {
  const n = BigInt(nCalls < 1 ? 1 : nCalls);
  return {
    sender: aa,
    nonce,
    initCode: '0x',
    callData,
    callGasLimit: 200000n + 80000n * n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    paymasterAndData: '0x',
    signature: packSudoSignature(DUMMY65),
  };
}

async function fees() {
  const block = await jrpc(RPC, 'eth_getBlockByNumber', ['latest', false]);
  const base = word(block.baseFeePerGas || '0x0');
  const maxPriorityFeePerGas = 10n ** 9n;
  return { maxFeePerGas: base * 2n + maxPriorityFeePerGas, maxPriorityFeePerGas };
}

async function simulateHandleOps(op, from) {
  try {
    await jrpc(RPC, 'eth_call', [{ from, to: ENTRY_POINT, data: encodeHandleOps(op, from) }, 'latest']);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message || '' };
  }
}

async function sendOp(aa, owner, callData, nCalls) {
  const nonce = word(await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetNonce(aa) }, 'latest']));
  const f = await fees();
  const op = buildOp(aa, nonce, callData, nCalls, f);
  const dummySim = await simulateHandleOps(op, owner);
  if (dummySim.ok) fail('dummy signature must fail simulate');
  const uoh = '0x' + (await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetUserOpHash(op) }, 'latest'])).slice(-64);
  op.signature = packSudoSignature(await jrpc(RPC, 'personal_sign', [uoh, owner]));
  const sim = await simulateHandleOps(op, owner);
  if (!sim.ok) fail('simulate handleOps failed: ' + sim.message);
  const rec = await sendTx({ from: owner, to: ENTRY_POINT, data: encodeHandleOps(op, owner), value: '0x0' });
  const log = (rec.logs || []).find((l) => eq(l.topics?.[0], USER_OP_TOPIC));
  if (!log || parseUserOpEventData(log.data)?.ok !== true) fail('UserOp failed ' + rec.transactionHash);
  return rec;
}

async function createOurs(owner, index = 0n) {
  const aa = await predictOurs(owner, index);
  if (!hasCode(await jrpc(RPC, 'eth_getCode', [aa, 'latest']))) {
    await sendTx({ from: owner, to: ACCOUNT_FACTORY, data: encodeFactoryCreate(owner, index), value: '0x0' });
  }
  if (!hasCode(await jrpc(RPC, 'eth_getCode', [aa, 'latest']))) fail('ours still empty ' + aa);
  return aa;
}

async function createLegacy(owner) {
  const aa = await predictLegacy(owner);
  if (!hasCode(await jrpc(RPC, 'eth_getCode', [aa, 'latest']))) {
    const allowed = word(await jrpc(RPC, 'eth_call', [{ to: KERNEL_FACTORY, data: encodeIsAllowedImplementation() }, 'latest']));
    if (allowed === 0n) fail('legacy factory disallows KERNEL_IMPL');
    await sendTx({ from: owner, to: KERNEL_FACTORY, data: encodeCreateAccount(owner), value: '0x0' });
  }
  if (!hasCode(await jrpc(RPC, 'eth_getCode', [aa, 'latest']))) fail('legacy still empty ' + aa);
  return aa;
}

async function assertKernel(aa, owner) {
  const impl = addrOf(await jrpc(RPC, 'eth_getStorageAt', [aa, EIP1967_IMPL_SLOT, 'latest']));
  if (!eq(impl, KERNEL_IMPL)) fail('unexpected impl ' + impl + ' at ' + aa);
  const byKernel = await jrpc(RPC, 'eth_call', [
    { to: ECDSA_VALIDATOR, data: '0x20709efc' + aa.replace(/^0x/i, '').padStart(64, '0') },
    'latest',
  ]);
  const got = addrOf(byKernel);
  if (!eq(got, owner)) fail('ECDSA owner ' + got + ' want ' + owner + ' kernel ' + aa);
}

async function main() {
  await waitForRpc(RPC);
  await ensureAccountFactory(RPC);
  const used = new Set();
  const unusedKernel = () => takeOwner(used, [(o) => predictOurs(o), (o) => predictLegacy(o)]);
  const owners = {
    create: await unusedKernel(),
    rescue: await unusedKernel(),
    aa21: await unusedKernel(),
    strand: await unusedKernel(),
  };
  for (const o of Object.values(owners)) {
    if (eq(o, ANVIL_EOA)) fail('test owner must not be the seeded EOA');
  }
  const accounts = await jrpc(RPC, 'eth_accounts', []);
  for (const o of [...Object.values(owners), ANVIL_EOA, ...accounts]) {
    // Anvil 0–9 are EIP-7702 delegated on this mainnet fork; delegation hits missing historical state.
    await jrpc(RPC, 'anvil_setCode', [o, '0x']);
    await jrpc(RPC, 'anvil_setBalance', [o, '0x' + (10n ** 18n).toString(16)]);
  }

  const factoryCode = await jrpc(RPC, 'eth_getCode', [ACCOUNT_FACTORY, 'latest']);
  if (!hasCode(factoryCode)) fail('AccountFactory missing');
  try {
    await jrpc(RPC, 'eth_call', [{ to: ACCOUNT_FACTORY, data: '0x8da5cb5b' }, 'latest']);
    fail('factory owner() must revert');
  } catch {
    /* no owner */
  }
  try {
    await jrpc(RPC, 'eth_call', [
      { to: ACCOUNT_FACTORY, data: '0xbb30a974' + KERNEL_IMPL.slice(2).padStart(64, '0') + '0'.repeat(64) },
      'latest',
    ]);
    fail('factory setImplementation must revert');
  } catch {
    /* no admin */
  }
  const implConst = addrOf(
    await jrpc(RPC, 'eth_call', [{ to: ACCOUNT_FACTORY, data: '0x3a4741bd' }, 'latest'])
  );
  if (!eq(implConst, KERNEL_IMPL)) fail('IMPLEMENTATION() ' + implConst);

  const seeded = await snapshot(ANVIL_EOA);
  if (!seeded.picked.deployed || seeded.picked.source !== 'legacy' || !eq(seeded.picked.aa, seeded.legacyAddr)) {
    fail('seeded EOA must reconnect the legacy Kernel, got ' + JSON.stringify(seeded.picked));
  }
  await assertKernel(seeded.legacyAddr, ANVIL_EOA);

  const created = await createOurs(owners.create);
  const again = await createOurs(owners.create);
  if (!eq(created, again)) fail('create not idempotent');
  await assertKernel(created, owners.create);
  const i1 = await createOurs(owners.create, 1n);
  if (eq(i1, created)) fail('index 1 must differ');
  await assertKernel(i1, owners.create);
  const snapCreate = await snapshot(owners.create);
  if (snapCreate.picked.source !== 'ours' || !eq(snapCreate.picked.aa, created)) {
    fail('new owner must resolve to this page’s factory');
  }
  await jrpc(RPC, 'anvil_setBalance', [created, '0x' + (2n * 10n ** 18n).toString(16)]);
  const before = word(await jrpc(RPC, 'eth_getBalance', [DEST, 'latest']));
  await sendOp(created, owners.create, encodeExecute(DEST, 10n ** 16n, '0x'), 1);
  const after = word(await jrpc(RPC, 'eth_getBalance', [DEST, 'latest']));
  if (after - before !== 10n ** 16n) fail('simulate-before-send native amount');

  const rescuePred = await predictLegacy(owners.rescue);
  if (hasCode(await jrpc(RPC, 'eth_getCode', [rescuePred, 'latest']))) fail('rescue address already has code');
  await jrpc(RPC, 'anvil_setBalance', [rescuePred, '0x' + (5n * 10n ** 17n).toString(16)]);
  const snapRescue = await snapshot(owners.rescue);
  if (!snapRescue.picked.rescue || snapRescue.picked.source !== 'legacy' || snapRescue.picked.deployed) {
    fail('funded empty legacy must rescue, got ' + JSON.stringify(snapRescue.picked));
  }
  const rescued = await createLegacy(owners.rescue);
  if (!eq(rescued, rescuePred)) fail('rescue created a different address');
  await assertKernel(rescued, owners.rescue);
  const destBefore = word(await jrpc(RPC, 'eth_getBalance', [DEST, 'latest']));
  await sendOp(rescued, owners.rescue, encodeExecute(DEST, 10n ** 16n, '0x'), 1);
  const destAfter = word(await jrpc(RPC, 'eth_getBalance', [DEST, 'latest']));
  if (destAfter - destBefore !== 10n ** 16n) fail('rescued account could not send');

  const aa21 = await createOurs(owners.aa21);
  await jrpc(RPC, 'anvil_setBalance', [aa21, '0x0']);
  const dep0 = word(await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeBalanceOf(aa21) }, 'latest']));
  if (dep0 !== 0n) fail('aa21 account must start with 0 deposit');
  const f = await fees();
  const need = requiredPrefund(280000n, 300000n, 80000n, f.maxFeePerGas);
  if (missingPrefund(0n, 0n, 0n, 0n, need) !== 'prefund') fail('missingPrefund token-only empty');
  const nonce0 = word(await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetNonce(aa21) }, 'latest']));
  const dry = buildOp(aa21, nonce0, encodeExecute(USDC, 0n, encodeTransfer(DEST, 1n)), 1, f);
  const uoh0 = '0x' + (await jrpc(RPC, 'eth_call', [{ to: ENTRY_POINT, data: encodeGetUserOpHash(dry) }, 'latest'])).slice(-64);
  dry.signature = packSudoSignature(await jrpc(RPC, 'personal_sign', [uoh0, owners.aa21]));
  const drySim = await simulateHandleOps(dry, owners.aa21);
  if (drySim.ok) fail('token-only with 0 ETH and 0 deposit must fail simulate');
  if (!/AA21|prefund/i.test(drySim.message)) fail('expected AA21, got ' + drySim.message);

  await sendTx({
    from: owners.aa21,
    to: ENTRY_POINT,
    data: '0xb760faf9' + aa21.slice(2).padStart(64, '0'),
    value: '0x' + (5n * 10n ** 16n).toString(16),
  });
  const seededAa = seeded.legacyAddr;
  const usdcAmt = 10n ** 6n;
  await sendOp(seededAa, ANVIL_EOA, encodeExecute(USDC, 0n, encodeTransfer(aa21, usdcAmt)), 1);
  const usdcBefore = word(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(DEST) }, 'latest']));
  await sendOp(aa21, owners.aa21, encodeExecute(USDC, 0n, encodeTransfer(DEST, usdcAmt)), 1);
  const usdcAfter = word(await jrpc(RPC, 'eth_call', [{ to: USDC, data: encodeBalanceOf(DEST) }, 'latest']));
  if (usdcAfter - usdcBefore !== usdcAmt) fail('token-only with deposit did not transfer');

  const strandOurs = await createOurs(owners.strand);
  await jrpc(RPC, 'anvil_setBalance', [strandOurs, '0x' + (2n * 10n ** 18n).toString(16)]);
  const strandLegacy = await predictLegacy(owners.strand);
  await jrpc(RPC, 'anvil_setBalance', [strandLegacy, '0x' + (10n ** 17n).toString(16)]);
  const snapStrand = await snapshot(owners.strand);
  if (snapStrand.picked.source !== 'ours' || !snapStrand.picked.legacyStranded || !eq(snapStrand.picked.aa, strandOurs)) {
    fail('ours deployed + funded empty legacy must stay on ours and mark stranded: ' + JSON.stringify(snapStrand.picked));
  }
  await createLegacy(owners.strand);
  const snapAfter = await snapshot(owners.strand);
  if (snapAfter.picked.source !== 'ours' || snapAfter.picked.legacyStranded || !eq(snapAfter.picked.aa, strandOurs)) {
    fail('after older create, richer ours must stay selected: ' + JSON.stringify(snapAfter.picked));
  }
  if (!eq(snapAfter.picked.altAa, strandLegacy) || snapAfter.picked.altSource !== 'legacy') {
    fail('both live must expose the older account as alt: ' + JSON.stringify(snapAfter.picked));
  }
  if (!hasCode(await jrpc(RPC, 'eth_getCode', [strandLegacy, 'latest']))) fail('stranded legacy was not created');
  const snapPref = await snapshot(owners.strand, 'legacy');
  if (snapPref.picked.source !== 'legacy' || !eq(snapPref.picked.aa, strandLegacy) || snapPref.picked.altSource !== 'ours') {
    fail('prefer legacy must select the older live account: ' + JSON.stringify(snapPref.picked));
  }

  console.log('ok walkaway factory', ACCOUNT_FACTORY, 'ours', created, 'rescue', rescued, 'aa21', aa21, 'strand', strandOurs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
