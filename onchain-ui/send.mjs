import {
  ENTRY_POINT,
  KERNEL_FACTORY,
  KERNEL_IMPL,
  ACCOUNT_FACTORY,
  encodeExecute,
  encodeExecuteBatch,
  encodeTransfer,
  encodeWithdrawTo,
  encodeGetNonce,
  encodeGetUserOpHash,
  encodeHandleOps,
  encodeBalanceOf,
  encodeCreateAccount,
  encodeGetAccountAddress,
  encodeFactoryCreate,
  encodeFactoryGetAccount,
  encodeIsAllowedImplementation,
  packSudoSignature,
  nativeOutValue,
  epOutValue,
  parseAmt,
  requiredPrefund,
  missingPrefund,
  classifyHandleOpsRevert,
  isAddress,
  hasCode,
  accountFromWord,
  USER_OP_TOPIC,
  parseUserOpEventData,
} from './kernel.mjs';
import { $, eq, hex, word, fmtAmt, short, EMPTY_WALLET } from './util.mjs';
import { jrpc, getRpcUrl, call, kernelImpl } from './rpc.mjs';
import { destError } from './dest.mjs';

const DUMMY65 = '0x' + '11'.repeat(65);
const TIP = 10n ** 9n;

let S;
let feeMemo = { n: -1, p: null };
let maxQ = Promise.resolve();
let pendingTx = '';

export function initSend(api) {
  S = api;
}

export function getPendingTx() {
  return pendingTx;
}

function pendKey() {
  const aa = S?.aa?.();
  if (!aa) return '';
  return 'v1w-pend-' + (S.pendNs?.() || '') + S.chainId() + '-' + aa.toLowerCase();
}

function persistPend() {
  try {
    const k = pendKey();
    if (!k) return;
    if (pendingTx) sessionStorage.setItem(k, pendingTx);
    else sessionStorage.removeItem(k);
  } catch {
    /* private */
  }
}

export function setPendingTx(hash) {
  pendingTx = hash || '';
  persistPend();
}

export function forgetPendingTx() {
  pendingTx = '';
}

export function loadPendingTx() {
  try {
    const k = pendKey();
    pendingTx = k ? sessionStorage.getItem(k) || '' : '';
  } catch {
    pendingTx = '';
  }
}

const WALLET_NET = 'Your wallet is on a different network. Switch to this chain and try again.';
const WALLET_ACC = 'Your wallet switched accounts. Try again.';

async function assertWallet(wantEoa) {
  const want = S.chainId();
  let wcid = Number(await S.wallet('eth_chainId', []));
  if (wcid !== want) {
    try {
      await S.wallet('wallet_switchEthereumChain', [{ chainId: hex(want) }]);
    } catch {
      throw new Error(WALLET_NET);
    }
    wcid = Number(await S.wallet('eth_chainId', []));
    if (wcid !== want) throw new Error(WALLET_NET);
  }
  const acc = await S.wallet('eth_accounts', []);
  if (!eq(acc && acc[0], wantEoa || S.eoa())) throw new Error(WALLET_ACC);
}

function pickAmt(input, bal, decimals, label, extra) {
  const raw = (input?.value || '').trim();
  if (!raw) return 'Enter an amount.';
  try {
    const amount = parseAmt(raw, decimals);
    if (amount <= 0n) return 'Enter an amount.';
    const cap = extra.cap != null ? extra.cap : bal;
    if (amount > cap) {
      if (extra.kind === 'eth') return 'Leave a little ETH for gas. Try Max.';
      if (extra.kind === 'ep') return 'Leave a little prepaid gas. Try Max.';
      return 'More than this account holds.';
    }
    if (amount > bal) return 'More than this account holds.';
    return { amount, decimals, label, bal, ...extra };
  } catch (e) {
    return e.message || 'Enter an amount.';
  }
}

export function selectedPicks() {
  const picks = [];
  let err = '';
  const add = (r) => {
    if (typeof r === 'string') err = err || r;
    else picks.push(r);
  };
  const ethCap = $('amtEth').dataset.cap;
  const epCap = $('amtEp').dataset.cap;
  if ($('takeEth').checked)
    add(pickAmt($('amtEth'), word($('ethBal').dataset.wei), 18, 'ETH', { kind: 'eth', cap: ethCap ? word(ethCap) : undefined }));
  if ($('takeEp').checked)
    add(
      pickAmt($('amtEp'), word($('epBal').dataset.wei), 18, 'prepaid gas', { kind: 'ep', cap: epCap ? word(epCap) : undefined })
    );
  for (const el of $('tokens').querySelectorAll('input[type="checkbox"]:checked')) {
    const t = S.tokens()[+el.dataset.i];
    if (!t) continue;
    add(pickAmt(el.closest('.tok')?.querySelector('[data-amt]'), t.bal, t.decimals, t.symbol, { kind: 'tok', token: t }));
  }
  return { picks, err, ready: picks.length > 0 && !err };
}

function feesFromBlock(block) {
  const base = word(block.baseFeePerGas || '0x0');
  const maxPriorityFeePerGas = TIP;
  const maxFeePerGas = base * 2n + TIP;
  return { maxFeePerGas, maxPriorityFeePerGas };
}

/** Fat limits; unused prefund refunds to the Kernel. Scale call gas with batch size. */
function opGas(nCalls) {
  const n = BigInt(nCalls < 1 ? 1 : nCalls);
  return {
    callGasLimit: 200000n + 80000n * n,
    verificationGasLimit: 300000n,
    preVerificationGas: 80000n,
  };
}

export async function waitTx(hash, opts) {
  // 180s of 2s receipt polls — live inclusion can take many blocks
  const wantOp = !opts || opts.userOp !== false;
  const until = Date.now() + 180000;
  const url = getRpcUrl();
  while (Date.now() < until) {
    try {
      const rec = await jrpc(url, 'eth_getTransactionReceipt', [hash]);
      if (rec) {
        if (word(rec.status) === 0n) {
          setPendingTx('');
          throw new Error('The transaction was included but reverted. Try again.');
        }
        if (wantOp) {
          const log = (rec.logs || []).find((l) => eq((l.topics || [])[0], USER_OP_TOPIC));
          if (log && parseUserOpEventData(log.data)?.ok === false) {
            setPendingTx('');
            throw new Error('The account rejected this send (UserOp failed). Try again with a smaller amount.');
          }
        }
        setPendingTx('');
        return rec;
      }
    } catch (e) {
      if (/reverted|UserOp failed|AA2[134]|didn't pay prefund/i.test(e.message || '')) throw e;
      // HTML/RPC blips retry until timeout; hash is kept for the receipt
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  setPendingTx(hash);
  const err = new Error('Still waiting for the transaction. Don’t send again until it confirms.');
  err.txHash = hash;
  throw err;
}

const PREFUND_MSG = 'The smart account needs ETH or prepaid gas for this send. Add some, or send less.';

function classifySim(msg) {
  return classifyHandleOpsRevert(msg);
}

async function simulateOp(op, from) {
  try {
    await jrpc(getRpcUrl(), 'eth_call', [{ from, to: ENTRY_POINT, data: encodeHandleOps(op, from) }, 'latest']);
    return { ok: true };
  } catch (e) {
    const message = e.message || 'Simulation failed.';
    return { ok: false, message, kind: classifySim(message) };
  }
}

async function sendOp(op, from) {
  await assertWallet(from);
  const data = encodeHandleOps(op, from);
  const txHash = await S.wallet('eth_sendTransaction', [
    { from, to: ENTRY_POINT, data, value: '0x0' },
  ]);
  setPendingTx(txHash);
  try {
    await waitTx(txHash);
    return txHash;
  } catch (e) {
    e.txHash = e.txHash || txHash;
    throw e;
  }
}

async function onePhase(callData, nCalls, fees) {
  const [nonceHex, block] = await Promise.all([
    call(ENTRY_POINT, encodeGetNonce(S.aa())),
    fees ? null : jrpc(getRpcUrl(), 'eth_getBlockByNumber', ['latest', false]),
  ]);
  const { maxFeePerGas, maxPriorityFeePerGas } = fees || feesFromBlock(block);
  const dummy = packSudoSignature(DUMMY65);
  const op = {
    sender: S.aa(),
    nonce: word(nonceHex),
    initCode: '0x',
    callData,
    ...opGas(nCalls),
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymasterAndData: '0x',
    signature: dummy,
  };
  const hash = '0x' + (await call(ENTRY_POINT, encodeGetUserOpHash(op))).slice(-64);
  const eoa = S.eoa();
  const sign = async (method, args) => {
    op.signature = packSudoSignature(await S.wallet(method, args));
  };
  S.setStatus('Approve in your wallet…');
  await assertWallet(eoa);
  await sign('personal_sign', [hash, eoa]);
  let sim = await simulateOp(op, eoa);
  if (!sim.ok && sim.kind === 'sig') {
    try {
      // eth_sign is the only widely-exposed raw-hash path; wallets may refuse it
      await assertWallet(eoa);
      await sign('eth_sign', [eoa, hash]);
      sim = await simulateOp(op, eoa);
    } catch (e2) {
      throw new Error(e2.message || 'Wallet refused the backup signature. Try again or use a different wallet.');
    }
  }
  if (!sim.ok) {
    if (sim.kind === 'prefund') throw new Error(PREFUND_MSG);
    throw new Error(sim.message);
  }
  S.setStatus('Confirm in your wallet…');
  return await sendOp(op, eoa);
}

export async function phaseFees(nCalls = 1) {
  const block = await jrpc(getRpcUrl(), 'eth_getBlockByNumber', ['latest', false]);
  const fees = feesFromBlock(block);
  const gas = opGas(nCalls);
  return {
    fees,
    prefund: requiredPrefund(
      gas.callGasLimit,
      gas.verificationGasLimit,
      gas.preVerificationGas,
      fees.maxFeePerGas
    ),
  };
}

export function sendFail(e) {
  return (e && e.message) || 'Send failed. Check your wallet and try again.';
}

export function feeN() {
  const n = document.querySelectorAll('#assets input[type="checkbox"]:checked').length;
  return n < 1 ? 1 : n;
}

export function resetFeeMemo() {
  feeMemo = { n: -1, p: null };
}

async function feePrefund() {
  const n = feeN();
  if (feeMemo.n === n && feeMemo.p != null) return feeMemo.p;
  await S.ensureRpc();
  const p = (await phaseFees(n)).prefund;
  feeMemo = { n, p };
  return p;
}

async function applyMax(tok, opts) {
  const select = !opts || opts.select !== false;
  const overwrite = !opts || opts.overwrite !== false;
  const box = tok?.querySelector('input[type="checkbox"]');
  const input = tok?.querySelector('[data-amt]');
  const btn = tok?.querySelector('[data-max]');
  if (!box || !input || !btn) return;
  if (!overwrite && input.value.trim()) return;
  if (select) box.checked = true;
  if (select) S.setHint('amtErr', '');
  const kind = btn.dataset.max;
  let cap = 0n;
  let decimals = 18;
  if (kind === 'eth') {
    cap = word($('ethBal').dataset.wei);
  } else if (kind === 'ep') {
    cap = word($('epBal').dataset.wei);
  } else {
    const t = S.tokens()[+(btn.dataset.i ?? box.dataset.i)];
    if (!t) return;
    cap = t.bal;
    decimals = t.decimals;
  }
  if (cap === 0n) {
    box.checked = false;
    input.value = '';
    input.dataset.cap = '0';
    S.setGo();
    S.paintSelectAll();
    return;
  }
  if (kind === 'eth' || kind === 'ep') {
    try {
      const p = await feePrefund();
      cap = kind === 'eth' ? nativeOutValue(cap, p) : epOutValue(cap, p);
    } catch (e) {
      if (select) S.setHint('amtErr', e.message || 'Couldn’t read fees for Max.');
      return;
    }
    if (cap === 0n) {
      box.checked = false;
      input.value = '';
      input.dataset.cap = '0';
      if (select) S.setHint('amtErr', kind === 'eth' ? 'Leave a little ETH in the account for gas.' : 'Leave a little prepaid gas.');
      S.setGo();
      S.paintSelectAll();
      return;
    }
    input.dataset.cap = String(cap);
  }
  input.value = fmtAmt(cap, decimals, '', Infinity);
  S.setGo();
}

async function syncNativeMaxes() {
  feeMemo = { n: -1, p: null };
  for (const tok of $('assets').querySelectorAll('.tok')) {
    const k = tok.querySelector('[data-max]')?.dataset.max;
    if (k === 'eth' || k === 'ep') await applyMax(tok, { select: false, overwrite: true });
  }
}

export async function fillMax(btn) {
  const go = async () => {
    const tok = btn.closest('.tok');
    await applyMax(tok);
    const kind = tok?.querySelector('[data-max]')?.dataset.max;
    if (kind && kind !== 'eth' && kind !== 'ep') await syncNativeMaxes();
  };
  maxQ = maxQ.then(go, go);
  await maxQ;
}

export async function prefillMaxes(opts) {
  if (!S.deployed() || !S.eoa()) return;
  const overwrite = !!(opts && opts.overwrite);
  const run = async () => {
    for (const tok of $('assets').querySelectorAll('.tok')) {
      const kind = tok.querySelector('[data-max]')?.dataset.max;
      await applyMax(tok, { select: false, overwrite: overwrite || kind === 'eth' || kind === 'ep' });
    }
  };
  maxQ = maxQ.then(run, run);
  await maxQ;
}

export function clearAmts() {
  for (const el of $('assets').querySelectorAll('[data-amt]')) {
    el.value = '';
    delete el.dataset.cap;
  }
}

export async function send() {
  if (S.busy() || !S.deployed()) {
    if (S.busy()) S.setStatus('Already sending…');
    return;
  }
  if (pendingTx) {
    S.setStatus('A send is still confirming. Check Activity before sending again.', 'err');
    return;
  }
  const dest = $('dest').value.trim();
  const aa = S.aa();
  const eoa = S.eoa();
  const destErr = destError({ dest, aa });
  if (destErr) {
    S.setHint('destErr', destErr);
    return;
  }
  S.setHint('destErr', '');
  S.setHint('tokenErr', '');
  const { picks, err, ready } = selectedPicks();
  if (!ready) {
    S.setHint('amtErr', err || 'Pick assets and enter amounts.');
    return;
  }
  S.setHint('amtErr', '');
  const rpc = $('rpcIn').value.trim();
  if (rpc) localStorage.setItem(S.LS_RPC + S.chainId(), rpc);
  else localStorage.removeItem(S.LS_RPC + S.chainId());

  S.setBusy(true);
  S.setGo();
  S.clearReceipt();
  let lastHash = '';
  const to = eq(dest, eoa) ? 'your connected wallet' : short(dest);
  const summary = picks.map((p) => fmtAmt(p.amount, p.decimals, p.label)).join(' + ');
  try {
    await S.ensureRpc();
    await assertWallet(eoa);
    const eoaWei = word(await jrpc(getRpcUrl(), 'eth_getBalance', [eoa, 'latest']));
    if (eoaWei === 0n) {
      S.setStatus(EMPTY_WALLET, 'err');
      return;
    }
    S.setStatus('Preparing the send…');
    const n = picks.length;
    const needEth = picks.some((p) => p.kind === 'eth');
    const [paid, ethHex, depHex, destCode] = await Promise.all([
      phaseFees(n),
      jrpc(getRpcUrl(), 'eth_getBalance', [aa, 'latest']),
      call(ENTRY_POINT, encodeBalanceOf(aa)),
      needEth ? jrpc(getRpcUrl(), 'eth_getCode', [dest, 'latest']) : '0x',
    ]);
    const dest7702 = destError({ dest, aa, needEth, destCode });
    if (dest7702) S.setHint('destErr', dest7702);
    const ethOut = picks.filter((p) => p.kind === 'eth').reduce((s, p) => s + p.amount, 0n);
    const epOut = picks.filter((p) => p.kind === 'ep').reduce((s, p) => s + p.amount, 0n);
    const miss = missingPrefund(word(ethHex), word(depHex), ethOut, epOut, paid.prefund);
    if (miss === 'prefund') {
      S.setHint('amtErr', PREFUND_MSG);
      S.setStatus('');
      return;
    }
    if (miss === 'eth') {
      S.setHint('amtErr', 'Leave a little ETH for gas. Try Max.');
      S.setStatus('');
      return;
    }
    if (miss === 'ep') {
      S.setHint('amtErr', 'Leave a little prepaid gas. Try Max.');
      S.setStatus('');
      return;
    }
    const calls = [];
    for (const p of picks) {
      if (p.kind === 'tok') {
        calls.push({ to: p.token.address, value: 0n, data: encodeTransfer(dest, p.amount) });
        continue;
      }
      if (p.kind === 'eth') {
        const cap = nativeOutValue(word(ethHex), paid.prefund);
        if (p.amount > cap) {
          S.setHint('amtErr', 'Leave a little ETH for gas. Try Max.');
          S.setStatus('');
          return;
        }
        calls.push({ to: dest, value: p.amount, data: '0x' });
        continue;
      }
      const cap = epOutValue(word(depHex), paid.prefund);
      if (p.amount > cap) {
        S.setHint('amtErr', 'Leave a little prepaid gas. Try Max.');
        S.setStatus('');
        return;
      }
      calls.push({ to: ENTRY_POINT, value: 0n, data: encodeWithdrawTo(dest, p.amount) });
    }
    const callData =
      calls.length === 1 ? encodeExecute(calls[0].to, calls[0].value, calls[0].data) : encodeExecuteBatch(calls);
    lastHash = await onePhase(callData, n, paid.fees);
    setPendingTx('');
    S.setStatus('Sent. You can send again.', 'ok');
    S.setReceipt(summary, lastHash, to);
    S.pushHist(lastHash, picks, dest);
    clearAmts();
    await S.refreshAfterSend();
  } catch (e) {
    const hash = e.txHash || lastHash;
    S.setStatus(sendFail(e), 'err');
    if (hash) {
      $('tx').className = 'receipt';
      $('tx').innerHTML = S.txHashHtml(hash);
    }
  } finally {
    S.setBusy(false);
    S.setGo();
  }
}

export async function createKernel() {
  const stranded = !!S.legacyStranded?.();
  const rescueAddr = S.legacyAddr?.() || '';
  if (S.busy() || !S.eoa()) return;
  if (S.deployed() && !stranded) return;
  const eoa = S.eoa();
  const source = stranded ? 'legacy' : S.aaSource?.() || '';
  const aa = stranded && isAddress(rescueAddr) ? rescueAddr : S.aa();
  if (!isAddress(aa)) return;
  S.setBusy(true);
  S.setGo();
  try {
    await S.ensureRpc();
    const code = await jrpc(getRpcUrl(), 'eth_getCode', [aa, 'latest']);
    if (hasCode(code)) {
      if (!eq(await kernelImpl(aa), KERNEL_IMPL)) throw new Error('Account created with an unexpected implementation. Don’t send.');
      await S.refreshAccount({ quiet: false });
      return;
    }
    let to;
    let data;
    if (source === 'ours') {
      if (!hasCode(await jrpc(getRpcUrl(), 'eth_getCode', [ACCOUNT_FACTORY, 'latest']))) {
        throw new Error('This page’s factory is not on this chain yet.');
      }
      const predicted = accountFromWord(await call(ACCOUNT_FACTORY, encodeFactoryGetAccount(eoa)));
      if (!predicted || !eq(predicted, aa)) throw new Error('Account address changed. Refresh and try again.');
      to = ACCOUNT_FACTORY;
      data = encodeFactoryCreate(eoa);
    } else if (source === 'legacy') {
      if (word(await call(KERNEL_FACTORY, encodeIsAllowedImplementation(KERNEL_IMPL))) === 0n) {
        throw new Error(
          'The older factory no longer allows this account type. Funds already at this address need that factory.'
        );
      }
      const predicted = accountFromWord(await call(KERNEL_FACTORY, encodeGetAccountAddress(eoa)));
      if (!predicted || !eq(predicted, aa)) throw new Error('Account address changed. Refresh and try again.');
      to = KERNEL_FACTORY;
      data = encodeCreateAccount(eoa);
    } else {
      throw new Error('This page’s factory is not on this chain yet.');
    }
    await assertWallet(eoa);
    S.setStatus('Approve in your wallet…');
    const txHash = await S.wallet('eth_sendTransaction', [{ from: eoa, to, data, value: '0x0' }]);
    setPendingTx(txHash);
    S.setStatus('Creating your account…');
    try {
      await waitTx(txHash, { userOp: false });
    } catch (e) {
      const after = await jrpc(getRpcUrl(), 'eth_getCode', [aa, 'latest']);
      if (!hasCode(after)) throw e;
    }
    if (!eq(S.eoa(), eoa)) return;
    // Stranded create is the older address, not the selected Kernel.
    if (!stranded && !eq(S.aa(), aa)) return;
    if (!eq(await kernelImpl(aa), KERNEL_IMPL)) throw new Error('Account created with an unexpected implementation. Don’t send.');
    await S.refreshAccount({ quiet: true });
    if (!eq(S.eoa(), eoa)) return;
    if (!stranded && !eq(S.aa(), aa)) return;
    if (!S.deployed()) throw new Error('Create finished but the account is still empty. Try again.');
    if (!S.implOk()) throw new Error('Account created with an unexpected implementation. Don’t send.');
    S.setStatus(stranded ? 'Older account created.' : 'Account created. Copy the address to receive.', 'ok');
  } finally {
    S.setBusy(false);
    S.setGo();
  }
}

export async function checkPendingReceipt() {
  if (!pendingTx) return;
  try {
    const rec = await jrpc(getRpcUrl(), 'eth_getTransactionReceipt', [pendingTx]);
    if (!rec) return;
    setPendingTx('');
    if (word(rec.status) === 0n) {
      S.setStatus('The transaction was included but reverted. Try again.', 'err');
      return;
    }
    const log = (rec.logs || []).find((l) => eq((l.topics || [])[0], USER_OP_TOPIC));
    if (log && parseUserOpEventData(log.data)?.ok === false) {
      S.setStatus('The account rejected this send (UserOp failed). Try again with a smaller amount.', 'err');
    }
  } catch {
    /* still pending */
  }
}
