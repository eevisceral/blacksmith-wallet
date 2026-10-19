import {
  ENTRY_POINT,
  SESSION_KEY_VALIDATOR,
  VALIDATOR_APPROVED_STRUCT_HASH,
  EIP712_DOMAIN_TYPEHASH,
  KERNEL_EIP712_NAME,
  KERNEL_EIP712_VERSION,
  encodeGetNonce,
  hashUserOp,
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
import { keccak256, eip712Hash } from './eth-crypto.mjs';
import { castMktx, castSign } from './cast-sign.mjs';
import { keystorePath, requireUnlockedOwner, unlockedOwner, withPasswordFile } from './keystore.mjs';
import { unlockedSession, sessionUnlock, withUnlockedSession } from './session.mjs';
import { loadPolicy, policyCheck, reserveSpend, sessionCovers, markDryRun, sawDryRun } from './policy.mjs';
import { decodeCallData } from './tools-decode.mjs';
import { encodeBatchProof, encodePermissionProof, sessionMerkle } from './session-merkle.mjs';

const strip = (h) => String(h || '').replace(/^0x/i, '').toLowerCase();
const signedHold = new Map();

export function rememberSigned(op, userOpHash) {
  signedHold.set(String(userOpHash).toLowerCase(), op);
  return op;
}

export function heldSigned(userOpHash) {
  return signedHold.get(String(userOpHash).toLowerCase()) || null;
}

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

export async function userOpHashOf(op, chainId) {
  const cid = Number(chainId);
  if (cid !== 1 && cid !== 8453) throw new Error('chain must be 1 or 8453.');
  const rpcChainId = Number(await jrpc(getRpcUrl(), 'eth_chainId', [], 8000));
  if (rpcChainId !== cid) {
    throw new Error(`RPC chainId ${rpcChainId} does not match requested chain ${cid}. Refusing to sign against that node.`);
  }
  return hashUserOp(op, cid);
}

export function emptyOpFields(op) {
  const init = strip(op.initCode);
  const pm = strip(op.paymasterAndData);
  if (init && init !== '') return 'initCode must be empty. Create the account with the factory first.';
  if (pm && pm !== '') return 'paymasterAndData must be empty.';
  return '';
}

export function liveSubmitGuards({ exclusiveRpc, chain, rpcChainId, initCode, paymasterAndData }) {
  const c = Number(chain);
  if (c !== 1 && c !== 8453) return 'Live handleOps only on Ethereum (1) or Base (8453).';
  if (Number(rpcChainId) !== c) {
    return `RPC chainId ${rpcChainId} does not match requested chain ${c}.`;
  }
  if (!exclusiveRpc) {
    return 'Live handleOps needs an exclusive RPC (rpc argument or Alchemy key). The public snapshot is read-only.';
  }
  return emptyOpFields({ initCode, paymasterAndData });
}

export async function signUserOp(op, opts = {}) {
  const empty = emptyOpFields(op);
  if (empty) throw new Error(empty);
  const denied = policyCheck(op);
  if (denied) throw new Error(denied);
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
    const hash = await userOpHashOf({ ...op, signature: '0x' }, opts.chainId);
    const held = reserveSpend(op, hash);
    if (held) throw new Error(held);
    const sig = withUnlockedSession((file, pw) => castSign(file, pw, hash, { personal: true }));
    let packed = packSessionPluginSignature(session.address, sig);
    if (!session.unrestricted) {
      const decoded = decodeCallData(op.callData);
      const tree = sessionMerkle(session);
      const match = (call) => {
        const sel = String(call.data || '0x').replace(/^0x/i, '').slice(0, 8).padEnd(8, '0');
        return tree.perms.findIndex(
          (p) => p.target.toLowerCase() === String(call.to).toLowerCase() && p.sig.replace(/^0x/i, '').toLowerCase() === sel,
        );
      };
      if (decoded.kind === 'execute' && decoded.calls.length === 1) {
        const i = match(decoded.calls[0]);
        if (i < 0) throw new Error('No on-chain permission matches this call.');
        packed += encodePermissionProof(tree.perms[i], tree.proofs[i]).slice(2);
      } else if (decoded.kind === 'executeBatch' && decoded.calls.length) {
        const idxs = decoded.calls.map(match);
        if (idxs.some((i) => i < 0)) throw new Error('No on-chain permission matches every call in this batch.');
        packed += encodeBatchProof(idxs.map((i) => tree.perms[i]), idxs.map((i) => tree.proofs[i])).slice(2);
      } else {
        throw new Error('A limited session signs execute or executeBatch.');
      }
    }
    const signed = { ...op, signature: packed };
    rememberSigned(signed, hash);
    return { op: signed, signer: 'session', session: session.address, userOpHash: hash };
  }
  if (!owner) {
    throw new Error(
      sessionMiss && session
        ? `Session insufficient (${sessionMiss}) and owner keystore is locked.`
        : 'Unlock the owner keystore (or a covering session key) before sign_userop.',
    );
  }
  const hash = await userOpHashOf({ ...op, signature: '0x' }, opts.chainId);
  const held = reserveSpend(op, hash);
  if (held) throw new Error(held);
  requireUnlockedOwner();
  const sig = withPasswordFile((pw) => castSign(keystorePath(), pw, hash, { personal: true }));
  const signed = { ...op, signature: packSudoSignature(sig) };
  rememberSigned(signed, hash);
  return { op: signed, signer: 'owner', owner: owner.address, userOpHash: hash };
}

export function buildEnableData(session, nonce) {
  const merkleRoot = session.unrestricted ? '0x' + '00'.repeat(32) : sessionMerkle(session).root;
  return encodeSessionEnableData({
    sessionKey: session.address,
    merkleRoot,
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
  const selector = '0x' + strip(op.callData).slice(0, 8);
  const digest = validatorApprovedDigest({
    chainId,
    kernel,
    selector,
    validatorData: vdata,
    executor: '0x0000000000000000000000000000000000000000',
    enableData,
  });
  requireUnlockedOwner();
  const enableSig = withPasswordFile((pw) => castSign(keystorePath(), pw, digest, { personal: false }));
  const uohPlaceholder = op;
  return { enableData, digest, enableSig, va, vu, uohPlaceholder, vdata };
}

export async function attachEnableSignature(op, chainId, kernel, session, nonce) {
  const denied = policyCheck(op);
  if (denied) throw new Error(denied);
  const pack = signEnableMode({ op, chainId, kernel, session, nonce });
  const hash = await userOpHashOf({ ...op, signature: '0x' }, chainId);
  const held = reserveSpend(op, hash);
  if (held) throw new Error(held);
  const sessionSig = withUnlockedSession((file, pw) => castSign(file, pw, hash, { personal: true }));
  const validatorSig = session.address.replace(/^0x/, '') + strip(sessionSig);
  op.signature = packEnableSignature({
    validAfter: pack.va,
    validUntil: pack.vu,
    enableData: pack.enableData,
    enableSig: pack.enableSig,
    validatorSig: '0x' + validatorSig,
  });
  rememberSigned(op, hash);
  return { op, userOpHash: hash, enableData: pack.enableData };
}

function aaHint(m) {
  if (/AA25/i.test(m)) return 'AA25 — stale nonce. Rebuild the UserOp.';
  if (classifyHandleOpsRevert(m) === 'prefund' || /AA21/i.test(m)) {
    return 'AA21 — the Kernel cannot cover the prefund. Add ETH to the Kernel or to its EntryPoint deposit, or send less.';
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

export async function submitUserOp(op, { live = false, dry_run, chain, eoa, exclusiveRpc = false } = {}) {
  const isLive = live === true && dry_run !== true;
  const owner = unlockedOwner();
  const from = eoa || (owner && owner.address);
  if (!from) throw new Error('Pass eoa for dry_run, or unlock the owner keystore.');
  if (isLive) {
    if (!owner) throw new Error('Unlock the owner keystore. The owner EOA pays outer handleOps gas (even when a session key signed the UserOp).');
    if (strip(from) !== strip(owner.address)) throw new Error('Unlocked keystore address does not match the handleOps EOA.');
  }
  const empty = emptyOpFields(op);
  if (empty) throw new Error(empty);
  const rpcChainHex = await jrpc(getRpcUrl(), 'eth_chainId', [], 8000);
  const rpcChainId = Number(rpcChainHex);
  const claimed = await userOpHashOf({ ...op, signature: '0x' }, chain ?? rpcChainId);
  const stored = heldSigned(claimed);
  if (isLive && !stored) {
    throw new Error('This process has not signed that UserOp. sign_userop keeps the signature here. It is not returned to the chat.');
  }
  if (stored) op = stored;
  if (isLive) {
    const g = liveSubmitGuards({
      exclusiveRpc,
      chain,
      rpcChainId,
      initCode: op.initCode,
      paymasterAndData: op.paymasterAndData,
    });
    if (g) throw new Error(g);
  } else if (chain != null && Number(chain) !== rpcChainId) {
    throw new Error(`RPC chainId ${rpcChainId} does not match requested chain ${chain}.`);
  }
  const nonceNow = word(await call(ENTRY_POINT, encodeGetNonce(op.sender)));
  if (nonceNow !== BigInt(op.nonce)) {
    throw new Error(`Nonce changed (draft ${op.nonce}, chain ${nonceNow}). Abort — rebuild and re-sign.`);
  }
  const hash = await userOpHashOf(op, chain);
  if (isLive) {
    const pol = loadPolicy();
    const p = policyCheck(op, pol);
    if (p) throw new Error(p);
    if (pol.require_dry_run_first && !sawDryRun(hash)) {
      throw new Error('policy: require_dry_run_first — call submit_userop without live:true first.');
    }
    const held = reserveSpend(op, hash, pol);
    if (held) throw new Error(held);
  }
  const sim = await simulateHandleOps(op, from);
  if (!isLive) {
    if (sim.ok) markDryRun(hash);
    return { dry_run: true, userOpHash: hash, simulation: sim.text };
  }
  if (!sim.ok) throw new Error('Live submit blocked: ' + sim.text);
  const nonceAgain = word(await call(ENTRY_POINT, encodeGetNonce(op.sender)));
  if (nonceAgain !== BigInt(op.nonce)) {
    throw new Error(`Nonce changed after simulation (draft ${op.nonce}, chain ${nonceAgain}). Abort — rebuild and re-sign.`);
  }
  const cid2 = Number(await jrpc(getRpcUrl(), 'eth_chainId', [], 8000));
  if (cid2 !== Number(chain)) throw new Error(`RPC chainId changed to ${cid2} before broadcast.`);
  const [txNonce, block, gasHex] = await Promise.all([
    jrpc(getRpcUrl(), 'eth_getTransactionCount', [from, 'pending']),
    jrpc(getRpcUrl(), 'eth_getBlockByNumber', ['latest', false]),
    jrpc(getRpcUrl(), 'eth_estimateGas', [{ from, to: ENTRY_POINT, data: encodeHandleOps(op, from) }]).catch(() => '0x30d40'),
  ]);
  const base = word((block && block.baseFeePerGas) || '0x0');
  const tip = 10n ** 9n;
  requireUnlockedOwner();
  const raw = withPasswordFile((pw) =>
    castMktx(keystorePath(), pw, {
      chainId: Number(chain),
      nonce: word(txNonce),
      maxPriorityFeePerGas: tip,
      maxFeePerGas: base * 2n + tip,
      gas: word(gasHex) + 50000n,
      to: ENTRY_POINT,
      value: 0n,
      data: encodeHandleOps(op, from),
    }),
  );
  const txHash = await jrpc(getRpcUrl(), 'eth_sendRawTransaction', [raw]);
  return { live: true, userOpHash: hash, txHash, tx: keccak256(raw) };
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
      signature: '0x',
    },
    null,
    2,
  );
}

void encodeSessionDisableKey;

export function encodeSessionDisableCall(sessionKey) {
  const body = strip(encodeSessionDisableKey(sessionKey));
  const pad = (64 - (body.length % 64)) % 64;
  return '0x8fc925aa' + BigInt(32).toString(16).padStart(64, '0') + BigInt(body.length / 2).toString(16).padStart(64, '0') + body + '0'.repeat(pad);
}
void abiWord;
