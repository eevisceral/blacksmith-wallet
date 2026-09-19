/** UserOp signing + EIP-712 enable digest + handleOps submit. */
import {
  ENTRY_POINT,
  SESSION_KEY_VALIDATOR,
  VALIDATOR_APPROVED_STRUCT_HASH,
  EIP712_DOMAIN_TYPEHASH,
  KERNEL_EIP712_NAME,
  KERNEL_EIP712_VERSION,
  EXECUTE_SEL,
  encodeGetNonce,
  encodeGetUserOpHash,
  encodeHandleOps,
  encodeSessionEnableData,
  encodeSessionDisableKey,
  packSudoSignature,
  packSessionPluginSignature,
  packEnableSignature,
  sessionValidatorData,
  classifyHandleOpsRevert,
} from '../onchain-ui/kernel.mjs';
import { call, jrpc, getRpcUrl } from '../onchain-ui/rpc.mjs';
import { word, hex } from '../onchain-ui/util.mjs';
import { keccak256, personalSign, signHash, eip712Hash, signEip1559Tx, hexBuf } from './eth-crypto.mjs';
import { unlockedOwner } from './keystore.mjs';
import { unlockedSession, sessionUnlock } from './session.mjs';
import { loadPolicy, policyCheck, sessionCovers, markDryRun, sawDryRun } from './policy.mjs';

const strip = (h) => String(h || '').replace(/^0x/i, '').toLowerCase();

function abiWord(h) {
  return strip(h).padStart(64, '0');
}

export function kernelDomainSeparator(chainId, kernel) {
  const nameHash = keccak256(Buffer.from(KERNEL_EIP712_NAME));
  const verHash = keccak256(Buffer.from(KERNEL_EIP712_VERSION));
  return keccak256(
    '0x' +
      strip(EIP712_DOMAIN_TYPEHASH) +
      strip(nameHash) +
      strip(verHash) +
      BigInt(chainId).toString(16).padStart(64, '0') +
      strip(kernel).padStart(64, '0'),
  );
}

export function validatorApprovedDigest({ chainId, kernel, selector, validatorData, executor, enableData }) {
  const sel = strip(selector).padEnd(8, '0').slice(0, 8).padEnd(64, '0');
  const enableHash = keccak256(enableData);
  const structHash = keccak256(
    '0x' +
      strip(VALIDATOR_APPROVED_STRUCT_HASH) +
      sel +
      strip(validatorData).padStart(64, '0') +
      strip(executor).padStart(64, '0') +
      strip(enableHash),
  );
  return eip712Hash(kernelDomainSeparator(chainId, kernel), structHash);
}

export async function userOpHashOf(op) {
  return '0x' + (await call(ENTRY_POINT, encodeGetUserOpHash(op))).slice(-64);
}

export async function signUserOp(op, opts = {}) {
  const owner = unlockedOwner();
  let session = unlockedSession();
  if (!session && owner) {
    try {
      sessionUnlock();
      session = unlockedSession();
    } catch {
      session = null;
    }
  }
  const prefer = opts.signer === 'owner' ? 'owner' : opts.signer === 'session' ? 'session' : 'auto';
  const sessionMiss = session ? sessionCovers(op, session) : 'no session';
  const useSession = prefer !== 'owner' && session && !sessionMiss;
  if (prefer === 'session' && sessionMiss) throw new Error('Session key cannot sign this UserOp: ' + sessionMiss);
  if (useSession) {
    const hash = await userOpHashOf({ ...op, signature: '0x' });
    const sig = personalSign(session.priv, hash);
    return { op: { ...op, signature: packSessionPluginSignature(session.address, sig) }, signer: 'session', session: session.address, userOpHash: hash };
  }
  if (!owner) {
    throw new Error(
      sessionMiss && session
        ? `Session insufficient (${sessionMiss}) and owner keystore is locked.`
        : 'Unlock the owner keystore (or a covering session key) before sign_userop.',
    );
  }
  const hash = await userOpHashOf({ ...op, signature: '0x' });
  const sig = personalSign(owner.priv, hash);
  return { op: { ...op, signature: packSudoSignature(sig) }, signer: 'owner', owner: owner.address, userOpHash: hash };
}

export function buildEnableData(session, nonce) {
  return encodeSessionEnableData({
    sessionKey: session.address,
    merkleRoot: '0x' + '00'.repeat(32),
    validAfter: session.validAfter || 0,
    validUntil: session.validUntil || 0xfffffffffffe,
    paymaster: '0x0000000000000000000000000000000000000000',
    nonce,
  });
}

export function signEnableMode({ op, chainId, kernel, session, nonce, validAfter, validUntil }) {
  const owner = unlockedOwner();
  if (!owner) throw new Error('Owner keystore must be unlocked to sign the one-time session enable.');
  const va = validAfter ?? session.validAfter ?? 0;
  const vu = validUntil ?? session.validUntil ?? 0xfffffffffffe;
  const enableData = buildEnableData(session, nonce);
  const vdata = sessionValidatorData(va, vu);
  const digest = validatorApprovedDigest({
    chainId,
    kernel,
    selector: '0x' + EXECUTE_SEL,
    validatorData: vdata,
    executor: '0x0000000000000000000000000000000000000000',
    enableData,
  });
  const enableSig = signHash(owner.priv, digest);
  const uohPlaceholder = op;
  return { enableData, digest, enableSig, va, vu, uohPlaceholder, vdata };
}

export async function attachEnableSignature(op, chainId, kernel, session, nonce) {
  const pack = signEnableMode({ op, chainId, kernel, session, nonce });
  const hash = await userOpHashOf({ ...op, signature: '0x' });
  const sessionSig = personalSign(session.priv, hash);
  const validatorSig = session.address.replace(/^0x/, '') + strip(sessionSig);
  op.signature = packEnableSignature({
    validAfter: pack.va,
    validUntil: pack.vu,
    enableData: pack.enableData,
    enableSig: pack.enableSig,
    validatorSig: '0x' + validatorSig,
  });
  return { op, userOpHash: hash, enableData: pack.enableData };
}

function aaHint(m) {
  if (/AA25/i.test(m)) return 'AA25 — stale nonce. Rebuild the UserOp.';
  if (classifyHandleOpsRevert(m) === 'prefund' || /AA21/i.test(m)) {
    return 'AA21 — the account cannot cover the prefund. Add ETH or prepaid gas, or send less.';
  }
  if (/AA23/i.test(m)) return 'AA23 — validation reverted (not a signature miss). Check session enable, permissions, or callData.';
  if (classifyHandleOpsRevert(m) === 'sig' || /AA24/i.test(m)) {
    return 'AA24 — signature error. Re-sign the current userOpHash (session keys use personal_sign).';
  }
  return 'handleOps reverted: ' + m;
}

export async function simulateHandleOps(op, from) {
  try {
    await jrpc(getRpcUrl(), 'eth_call', [{ from, to: ENTRY_POINT, data: encodeHandleOps(op, from) }, 'latest']);
    return { ok: true, text: 'eth_call handleOps succeeded.' };
  } catch (e) {
    const m = (e && e.message) || 'simulation failed';
    return { ok: false, text: aaHint(m), raw: m };
  }
}

export async function submitUserOp(op, { live = false, dry_run, chain, eoa } = {}) {
  const isLive = live === true && dry_run !== true;
  const owner = unlockedOwner();
  const from = eoa || (owner && owner.address);
  if (!from) throw new Error('Pass eoa for dry_run, or unlock the owner keystore.');
  if (isLive) {
    if (!owner) throw new Error('Unlock the owner keystore. The owner EOA pays outer handleOps gas (even when a session key signed the UserOp).');
    if (strip(from) !== strip(owner.address)) throw new Error('Unlocked keystore address does not match the handleOps EOA.');
  }
  const nonceNow = word(await call(ENTRY_POINT, encodeGetNonce(op.sender)));
  if (nonceNow !== BigInt(op.nonce)) {
    throw new Error(`Nonce changed (draft ${op.nonce}, chain ${nonceNow}). Abort — rebuild and re-sign.`);
  }
  const hash = await userOpHashOf(op);
  if (isLive) {
    const pol = loadPolicy();
    const p = policyCheck(op, pol);
    if (p) throw new Error(p);
    if (pol.require_dry_run_first && !sawDryRun(hash)) {
      throw new Error('policy: require_dry_run_first — call submit_userop without live:true first.');
    }
  }
  const sim = await simulateHandleOps(op, from);
  if (!isLive) {
    if (sim.ok) markDryRun(hash);
    else markDryRun(hash);
    return { dry_run: true, userOpHash: hash, simulation: sim.text };
  }
  if (!sim.ok) throw new Error('Live submit blocked: ' + sim.text);
  const [txNonce, block, gasHex] = await Promise.all([
    jrpc(getRpcUrl(), 'eth_getTransactionCount', [from, 'pending']),
    jrpc(getRpcUrl(), 'eth_getBlockByNumber', ['latest', false]),
    jrpc(getRpcUrl(), 'eth_estimateGas', [{ from, to: ENTRY_POINT, data: encodeHandleOps(op, from) }]).catch(() => '0x30d40'),
  ]);
  const base = word((block && block.baseFeePerGas) || '0x0');
  const tip = 10n ** 9n;
  const signed = signEip1559Tx(owner.priv, {
    chainId: chain,
    nonce: word(txNonce),
    maxPriorityFeePerGas: tip,
    maxFeePerGas: base * 2n + tip,
    gas: word(gasHex) + 50000n,
    to: ENTRY_POINT,
    value: 0n,
    data: encodeHandleOps(op, from),
  });
  const txHash = await jrpc(getRpcUrl(), 'eth_sendRawTransaction', [signed.raw]);
  return { live: true, userOpHash: hash, txHash, tx: signed.hash };
}

export function opJson(op) {
  return JSON.stringify(
    {
      sender: op.sender,
      nonce: hex(op.nonce),
      initCode: op.initCode,
      callData: op.callData,
      callGasLimit: hex(op.callGasLimit),
      verificationGasLimit: hex(op.verificationGasLimit),
      preVerificationGas: hex(op.preVerificationGas),
      maxFeePerGas: hex(op.maxFeePerGas),
      maxPriorityFeePerGas: hex(op.maxPriorityFeePerGas),
      paymasterAndData: op.paymasterAndData,
      signature: op.signature,
    },
    null,
    2,
  );
}

void hexBuf;
void encodeSessionDisableKey;

export function encodeSessionDisableCall(sessionKey) {
  const body = strip(encodeSessionDisableKey(sessionKey));
  const pad = (64 - (body.length % 64)) % 64;
  return '0x8fc925aa' + BigInt(32).toString(16).padStart(64, '0') + BigInt(body.length / 2).toString(16).padStart(64, '0') + body + '0'.repeat(pad);
}
void abiWord;
