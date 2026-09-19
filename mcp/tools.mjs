/**
 * Tool handlers for the Blacksmith wallet MCP: reads, dry-run drafts, optional
 * local keystore/session signing, and EntryPoint.handleOps under policy.
 * Encoding and RPC failover come from the wallet (onchain-ui/kernel.mjs, rpc.mjs).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENTRY_POINT,
  KERNEL_FACTORY,
  ACCOUNT_FACTORY,
  KERNEL_IMPL,
  CHAINS,
  ZERO_ADDR,
  EXECUTE_SEL,
  EXECUTE_BATCH_SEL,
  encodeExecute,
  encodeExecuteBatch,
  encodeTransfer,
  encodeWithdrawTo,
  encodeBalanceOf,
  encodeGetNonce,
  encodeGetUserOpHash,
  encodeHandleOps,
  encodeCreateAccount,
  encodeGetAccountAddress,
  encodeFactoryCreate,
  encodeFactoryGetAccount,
  encodeIsAllowedImplementation,
  packSudoSignature,
  ECDSA_VALIDATOR,
  SESSION_KEY_VALIDATOR,
  requiredPrefund,
  nativeOutValue,
  epOutValue,
  missingPrefund,
  parseAmt,
  pickAccount,
  classifyHandleOpsRevert,
  kernelExecImpl,
  kernelBatchImpl,
  hasCode,
  accountFromWord,
  isAddress,
  logTopicAddr,
  parseUserOpEventData,
  parseWithdrawnData,
  parseReceivedData,
} from '../onchain-ui/kernel.mjs';
import {
  chooseRpc,
  setRpcUrl,
  getRpcUrl,
  getRpcAlts,
  rpcHasDeepLogs,
  jrpc,
  call,
  kernelImpl,
  decodeStr,
  walkTransfersIn,
  scanAccountLogs,
  scanRangeLogs,
  pruneFloor,
  TOK_WALK_PUBLIC,
  TOK_WALK_CUSTOM,
  LOGS_LOOKBACK,
  LOGS_RANGE_MAX,
} from '../onchain-ui/rpc.mjs';
import { destError } from '../onchain-ui/dest.mjs';
import { eq, hex, word, fmtAmt, short } from '../onchain-ui/util.mjs';
import { alchKey, alchRpc, alchPortfolio, alchTransfers, fmtUsd } from '../onchain-ui/alchemy.mjs';
import { decodeCallData as decodeCallDataInner } from './tools-decode.mjs';
import { keystoreStatus, keystoreUnlock, keystoreLock } from './keystore.mjs';
import { sessionStatus, sessionCreate, sessionUnlock, sessionRevokeLocal, unlockedSession } from './session.mjs';
import { signUserOp, submitUserOp, opJson as signedOpJson, attachEnableSignature, encodeSessionDisableCall } from './aa-sign.mjs';
import { loadPolicy } from './policy.mjs';

export const WALLET_URL = 'https://blacksmith-wallet.pages.dev/';
/** Placeholder signature for drafts; the wallet replaces it with 0x00000000 ‖ 65-byte ECDSA.
 *  This Kernel's ECDSA validator reverts a bad signature (AA23) rather than returning a
 *  failure code (AA24) — simulateText reads both as "reached the signature check". */
const DUMMY65 = '0x' + '11'.repeat(64) + '1b';
const TIP = 10n ** 9n;
const SIG_SUDO = '00000000';

/* Fee and gas policy mirror send.mjs (fat limits; unused prefund refunds to the Kernel). */
function feesFromBlock(block) {
  const base = word((block && block.baseFeePerGas) || '0x0');
  return { maxFeePerGas: base * 2n + TIP, maxPriorityFeePerGas: TIP };
}

function opGas(nCalls) {
  const n = BigInt(nCalls < 1 ? 1 : nCalls);
  return { callGasLimit: 200000n + 80000n * n, verificationGasLimit: 300000n, preVerificationGas: 80000n };
}

const stripHex = (h) =>
  String(h || '')
    .replace(/^0x/i, '')
    .toLowerCase();

export function normChain(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (s === '1' || s === 'ethereum' || s === 'eth' || s === 'mainnet') return 1;
  if (s === '8453' || s === 'base') return 8453;
  throw new Error('chain must be 1 (Ethereum) or 8453 (Base).');
}

function needAddress(v, label) {
  const a = String(v || '').trim();
  if (!isAddress(a)) throw new Error(`Enter a valid ${label} address (0x + 40 hex).`);
  return a;
}

function needHex(v, label) {
  const s = String(v || '0x').trim();
  if (!/^0x([0-9a-fA-F]{2})*$/.test(s)) throw new Error(`${label} must be 0x-hex.`);
  return s;
}

function optInt(v, label) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number.`);
  return Math.floor(n);
}

/* rpc.mjs keeps one active URL set per process, so chain work serializes through this
 * queue; chosen sessions are cached per chain+custom-RPC and re-probed after a failure. */
const sessions = new Map();
let chainQ = Promise.resolve();

async function withChain(chain, a, fn) {
  const pasted = typeof (a && a.rpc) === 'string' && a.rpc.trim() ? a.rpc.trim() : '';
  const via = pasted || alchRpc(alchKey((a && a.alchemy) || process.env.ALCHEMY_API_KEY || ''), chain);
  const key = chain + '|' + via;
  const run = chainQ.catch(() => {}).then(async () => {
    let s = sessions.get(key);
    if (!s) {
      try {
        await chooseRpc(chain, via || undefined, CHAINS[chain].rpcs);
      } catch (e) {
        if (via) {
          throw new Error(
            `Custom RPC failed (${e.message || e}). It is the only URL tried — paste another or unset it; there is no public fall-through.`,
          );
        }
        throw e;
      }
      s = { url: getRpcUrl(), alts: getRpcAlts(), deep: rpcHasDeepLogs(), custom: !!via };
      sessions.set(key, s);
    } else {
      setRpcUrl(s.url, s.alts);
    }
    try {
      return await fn(s);
    } catch (e) {
      sessions.delete(key);
      throw e;
    }
  });
  chainQ = run.catch(() => {});
  return run;
}

/** The wallet's resolve rules (SKILL.md): live legacy > live page factory > funded legacy rescue > create. */
async function resolveOnChain(eoa) {
  const [factoryCode, legacyFactoryCode] = await Promise.all([
    jrpc(getRpcUrl(), 'eth_getCode', [ACCOUNT_FACTORY, 'latest']),
    jrpc(getRpcUrl(), 'eth_getCode', [KERNEL_FACTORY, 'latest']),
  ]);
  const factoryOnChain = hasCode(factoryCode);
  const legacyAddr = hasCode(legacyFactoryCode)
    ? accountFromWord(await call(KERNEL_FACTORY, encodeGetAccountAddress(eoa)))
    : '';
  let legacyCode = '0x';
  let legacyEth = 0n;
  let legacyDeposit = 0n;
  if (legacyAddr) {
    const [code, ethHex, depHex] = await Promise.all([
      jrpc(getRpcUrl(), 'eth_getCode', [legacyAddr, 'latest']),
      jrpc(getRpcUrl(), 'eth_getBalance', [legacyAddr, 'latest']),
      call(ENTRY_POINT, encodeBalanceOf(legacyAddr)),
    ]);
    legacyCode = code;
    legacyEth = word(ethHex);
    legacyDeposit = word(depHex);
  }
  const ourAddr = factoryOnChain ? accountFromWord(await call(ACCOUNT_FACTORY, encodeFactoryGetAccount(eoa))) : '';
  const ourCode = ourAddr ? await jrpc(getRpcUrl(), 'eth_getCode', [ourAddr, 'latest']) : '0x';
  let ourEth = 0n;
  let ourDeposit = 0n;
  if (ourAddr && hasCode(ourCode)) {
    const [ethHex, depHex] = await Promise.all([
      jrpc(getRpcUrl(), 'eth_getBalance', [ourAddr, 'latest']),
      call(ENTRY_POINT, encodeBalanceOf(ourAddr)),
    ]);
    ourEth = word(ethHex);
    ourDeposit = word(depHex);
  }
  const picked = pickAccount({
    legacyAddr,
    legacyCode,
    legacyEth,
    legacyDeposit,
    factoryOnChain,
    ourAddr,
    ourCode,
    ourEth,
    ourDeposit,
  });
  let impl = '';
  let execOk = false;
  let batch = false;
  if (picked.deployed) {
    impl = await kernelImpl(picked.aa);
    execOk = kernelExecImpl(impl);
    batch = kernelBatchImpl(impl);
  }
  const eth = picked.source === 'legacy' ? legacyEth : ourEth;
  const deposit = picked.source === 'legacy' ? legacyDeposit : ourDeposit;
  return { picked, impl, execOk, batch, factoryOnChain, legacyAddr, ourAddr, eth, deposit };
}

/** account (Kernel address) or eoa (owner, resolved first). */
async function accountArg(a) {
  const direct = String(a.account || '').trim();
  if (direct) return { aa: needAddress(direct, 'account'), note: '' };
  const eoa = needAddress(a.eoa, 'owner EOA (or pass account)');
  const r = await resolveOnChain(eoa);
  if (!r.picked.aa) {
    throw new Error("This page's factory is not on this chain yet, and this EOA has no live or funded legacy account here.");
  }
  const note = r.picked.deployed
    ? ''
    : ' — no code on this chain yet (create it in the wallet); the address can still hold funds';
  return { aa: r.picked.aa, note };
}

/** ERC-20 symbol/decimals, tolerating bytes32 symbols and missing metadata. */
async function tokenMeta(addr) {
  const [sym, decRaw] = await Promise.all([
    call(addr, '0x95d89b41').then(decodeStr).catch(() => ''),
    call(addr, '0x313ce567').then(word).catch(() => 18n),
  ]);
  const d = Number(decRaw);
  return { symbol: (sym || '').slice(0, 24) || short(addr), decimals: d >= 0 && d <= 36 ? d : 18 };
}

async function createText(r, eoa, chain) {
  const name = CHAINS[chain].name;
  if (r.picked.rescue) {
    const allowed = word(await call(KERNEL_FACTORY, encodeIsAllowedImplementation(KERNEL_IMPL))) !== 0n;
    const lines = [
      `No code at ${r.picked.aa} on ${name} yet, but that legacy address already holds ETH or a deposit — rescue path.`,
      '',
      'Create is a plain EOA transaction (not a UserOp):',
      `- to ${KERNEL_FACTORY} (legacy factory)`,
      `- data ${encodeCreateAccount(eoa)}`,
    ];
    if (!allowed) {
      lines.push('- the older factory no longer allows this account type; funds at that address need that factory. Stop here.');
    }
    lines.push('', `Or open ${WALLET_URL} — Connect and it offers the older-account create.`);
    return lines.join('\n');
  }
  if (!r.factoryOnChain) return `This page's factory is not on ${name} yet — no create path from here.`;
  return [
    `No Kernel on ${name} yet for ${eoa}. Predicted index-0 account: ${r.picked.aa} (this page's factory).`,
    '',
    'Create is a plain EOA transaction (not a UserOp):',
    `- to ${ACCOUNT_FACTORY} (permissionless factory)`,
    `- data ${encodeFactoryCreate(eoa)}`,
    '',
    `Or open ${WALLET_URL} — Connect → Create account.`,
  ].join('\n');
}

async function resolveAccount(a) {
  const eoa = needAddress(a.eoa, 'owner EOA');
  const chain = normChain(a.chain);
  return withChain(chain, a, async () => {
    const r = await resolveOnChain(eoa);
    const name = CHAINS[chain].name;
    if (!r.picked.aa) {
      return `This page's factory is not on ${name} yet, and ${eoa} has no live or funded legacy account on this chain — no Kernel path here.`;
    }
    const lines = [`Kernel account for ${eoa} on ${name} (chain ${chain}), index 0:`, ''];
    const where = r.picked.source === 'ours' ? "this page's factory" : 'legacy factory';
    lines.push(
      `**${r.picked.aa}** — ${r.picked.deployed ? 'live' : 'not deployed yet'} (${where}${r.picked.rescue ? ', rescue' : ''}).`,
    );
    if (r.picked.deployed) {
      const implNote = !r.execOk
        ? 'NOT a 0.2.x implementation this wallet sends with — do not send'
        : r.batch
          ? 'Kernel 0.2.x — execute + executeBatch'
          : 'Kernel 0.2.1 — execute only, one call per UserOp';
      lines.push(`- implementation ${r.impl || 'unknown'} — ${implNote}`);
      const nonceHex = await call(ENTRY_POINT, encodeGetNonce(r.picked.aa));
      lines.push(
        `- deployed: yes · nonce ${word(nonceHex)} (EntryPoint key 0) · ETH ${fmtAmt(r.eth, 18, 'ETH', Infinity)} · EntryPoint deposit ${fmtAmt(r.deposit, 18, 'ETH', Infinity)}`,
      );
      lines.push(
        `- validators: ECDSA sudo ${ECDSA_VALIDATOR} (owner EOA signs) · session keys ${SESSION_KEY_VALIDATOR} (enabled per key; MCP session tool)`,
      );
    } else {
      lines.push(await createText(r, eoa, chain));
    }
    if (r.picked.altAa) {
      lines.push(
        `- other live account: ${r.picked.altAa} (${r.picked.altSource === 'ours' ? "this page's factory" : 'legacy factory'}) — named, not switched`,
      );
    }
    if (r.picked.legacyStranded) {
      lines.push(
        `- stranded: the legacy address ${r.legacyAddr} holds ETH or a deposit with no code — create it there (the wallet offers this) to use those funds`,
      );
    }
    lines.push(
      '',
      `Reads are free. Creation is a plain owner-EOA factory transaction. Sends sign here (owner keystore / session keys, policy-gated) via sign_userop + submit_userop, or in the browser wallet: ${WALLET_URL}`,
    );
    return lines.join('\n');
  });
}

async function getBalances(a) {
  const chain = normChain(a.chain);
  return withChain(chain, a, async () => {
    const { aa, note } = await accountArg(a);
    const [ethHex, depHex] = await Promise.all([
      jrpc(getRpcUrl(), 'eth_getBalance', [aa, 'latest']),
      call(ENTRY_POINT, encodeBalanceOf(aa)),
    ]);
    const lines = [
      `${aa} on ${CHAINS[chain].name}${note}`,
      `- ETH: ${fmtAmt(word(ethHex), 18, 'ETH', Infinity)} (${word(ethHex)} wei)`,
      `- EntryPoint deposit: ${fmtAmt(word(depHex), 18, 'ETH', Infinity)} (${word(depHex)} wei)`,
    ];
    const pasted = Array.isArray(a.tokens) && a.tokens.length ? a.tokens.map((t) => needAddress(t, 'token')) : null;
    const list = pasted || CHAINS[chain].majors;
    const rows = await Promise.all(
      list.map(async (t) => {
        let bal;
        try {
          bal = word(await call(t, encodeBalanceOf(aa)));
        } catch {
          return pasted ? { t, err: true } : null;
        }
        if (bal === 0n && !pasted) return null;
        const m = await tokenMeta(t);
        return { t, bal, m };
      }),
    );
    for (const r of rows) {
      if (!r) continue;
      if (r.err) {
        lines.push(`- ${r.t}: unreadable (not an ERC-20?)`);
        continue;
      }
      lines.push(`- ${fmtAmt(r.bal, r.m.decimals, r.m.symbol, Infinity)} — ${r.t} (${r.bal} base units)`);
    }
    if (!pasted) lines.push('', 'Only nonzero pinned majors shown. Pass tokens: [0x…] to read specific contracts.');
    return lines.join('\n');
  });
}

async function listTokens(a) {
  const chain = normChain(a.chain);
  return withChain(chain, a, async (s) => {
    const { aa, note } = await accountArg(a);
    const pasted = (Array.isArray(a.tokens) ? a.tokens : []).map((t) => needAddress(t, 'token').toLowerCase());
    if (/alchemy\.com/.test(getRpcUrl()) && alchKey(getRpcUrl())) {
      try {
        const { rows, native } = await alchPortfolio(alchKey(getRpcUrl()), chain, aa);
        const extra = [];
        for (const t of pasted) {
          if (rows.some((r) => r.address === t)) continue;
          try {
            extra.push({ address: t, bal: word(await call(t, encodeBalanceOf(aa))), m: await tokenMeta(t) });
          } catch {
            extra.push({ address: t, err: true });
          }
        }
        const lines = [`Tokens held by ${aa} on ${CHAINS[chain].name}${note} (Alchemy Portfolio)`];
        if (native.usd) lines.push(`- ETH mark ${fmtUsd(native.usd)}`);
        const show = a.dust === false ? rows : rows.filter((t) => t.usd == null || t.usd >= 1);
        if (!show.length && !extra.length) lines.push('No tokens on this account yet.');
        for (const r of show) {
          const val = r.usd != null ? ` · ${fmtUsd(r.usd)}` : ' · unpriced';
          lines.push(`- ${fmtAmt(r.bal, r.decimals, r.symbol, Infinity)}${val} — ${r.address}`);
        }
        for (const r of extra) {
          if (r.err) lines.push(`- ${r.address}: unreadable`);
          else lines.push(`- ${fmtAmt(r.bal, r.m.decimals, r.m.symbol, Infinity)} — ${r.address}`);
        }
        return lines.join('\n');
      } catch {
        /* JSON-RPC walk below */
      }
    }
    const probe = [...new Set([...CHAINS[chain].majors.map((x) => x.toLowerCase()), ...pasted])];
    const found = new Map();
    await Promise.all(
      probe.map(async (t) => {
        try {
          const bal = word(await call(t, encodeBalanceOf(aa)));
          if (bal > 0n || pasted.includes(t)) found.set(t, bal);
        } catch {
          /* not an ERC-20 */
        }
      }),
    );
    const notes = [];
    let walkDone = false;
    if (a.walk) {
      const head = Number(await jrpc(getRpcUrl(), 'eth_blockNumber', []));
      const from = optInt(a.fromBlock, 'fromBlock') ?? 0;
      const b = s.custom ? TOK_WALK_CUSTOM : TOK_WALK_PUBLIC;
      const budget = { pages: b.pages, ms: b.ms, t0: Date.now(), used: 0 };
      let floor = head;
      try {
        const w = await walkTransfersIn(from, head, aa, {
          budget,
          descend: true,
          onPage: (_logs, lo) => {
            floor = Math.min(floor, lo);
          },
        });
        walkDone = w.done;
        const addrs = new Set(w.logs.map((l) => String(l.address).toLowerCase()));
        await Promise.all(
          [...addrs].map(async (t) => {
            if (found.has(t)) return;
            try {
              const bal = word(await call(t, encodeBalanceOf(aa)));
              if (bal > 0n) found.set(t, bal);
            } catch {
              /* not an ERC-20 */
            }
          }),
        );
        if (!w.done) {
          notes.push(
            `Scanned back to block ${floor}. Older tokens may need a pasted contract address or a custom/archive RPC.`,
          );
        }
      } catch (e) {
        if (e && (e.unserved || pruneFloor(e.message))) {
          notes.push('Public nodes can’t serve this account’s older blocks — paste token contract addresses or set an archive custom RPC.');
        } else {
          throw e;
        }
      }
    } else {
      notes.push('Majors probe at head only. Pass walk: true to page Transfer logs back toward account birth.');
    }
    const rows = await Promise.all(
      [...found.entries()].map(async ([t, bal]) => ({ t, bal, m: await tokenMeta(t) })),
    );
    rows.sort((x, y) => (x.bal > y.bal ? -1 : x.bal < y.bal ? 1 : 0));
    const lines = [`Tokens held by ${aa} on ${CHAINS[chain].name}${note}`];
    if (!rows.length) {
      lines.push(a.walk && walkDone ? 'No tokens on this account yet.' : 'No tokens found in the probed set.');
    }
    for (const r of rows) lines.push(`- ${fmtAmt(r.bal, r.m.decimals, r.m.symbol, Infinity)} — ${r.t}`);
    if (notes.length) lines.push('', ...notes);
    return lines.join('\n');
  });
}

function mergeActivity(pack, aa) {
  const byHash = new Map();
  const row = (hash, block) => {
    const k = String(hash).toLowerCase();
    let r = byHash.get(k);
    if (!r) {
      r = { hash, block: Number(block), ok: true, legs: [] };
      byHash.set(k, r);
    }
    r.block = Math.max(r.block, Number(block));
    return r;
  };
  for (const l of pack.ops || []) {
    if (!l.transactionHash) continue;
    const p = parseUserOpEventData(l.data);
    const r = row(l.transactionHash, l.blockNumber);
    if (p) {
      r.ok = p.ok;
      r.nonce = String(p.nonce);
      r.gas = p.gasCost;
    }
  }
  const xfer = (l, d) => {
    if ((l.topics || []).length !== 3 || !l.transactionHash) return;
    const peer = logTopicAddr(l.topics[d === 1 ? 1 : 2]);
    if (eq(peer, aa)) return;
    row(l.transactionHash, l.blockNumber).legs.push({
      d,
      k: String(l.address).toLowerCase(),
      amt: String(word(l.data)),
      p: eq(peer, ZERO_ADDR) ? '' : peer,
    });
  };
  for (const l of pack.ins || []) xfer(l, 1);
  for (const l of pack.outs || []) xfer(l, -1);
  for (const l of pack.wds || []) {
    const w = parseWithdrawnData(l.data);
    if (!w || !l.transactionHash) continue;
    row(l.transactionHash, l.blockNumber).legs.push({ d: -1, k: 'ep', amt: String(w.amount), p: w.to });
  }
  for (const l of pack.rcv || []) {
    const g = parseReceivedData(l.data);
    if (!g || !l.transactionHash || eq(g.from, aa)) continue;
    row(l.transactionHash, l.blockNumber).legs.push({ d: 1, k: 'eth', amt: String(g.amount), p: g.from });
  }
  return [...byHash.values()].sort((x, y) => y.block - x.block);
}

function rowTitle(legs, ok) {
  const failed = ok === false;
  if (!legs.length) return failed ? 'Failed send' : 'Send';
  const ins = legs.filter((x) => x.d === 1);
  const outs = legs.filter((x) => x.d === -1);
  const one = (xs) => (xs.length === 1 ? xs[0].sym : `${xs.length} assets`);
  if (ins.length && !outs.length) return failed ? 'Failed receive' : `Received ${one(ins)}`;
  if (outs.length && !ins.length) return failed ? 'Failed send' : `Sent ${one(outs)}`;
  return failed ? 'Failed send' : 'Send';
}

async function getActivity(a) {
  const chain = normChain(a.chain);
  return withChain(chain, a, async () => {
    const { aa, note } = await accountArg(a);
    const latest = Number(await jrpc(getRpcUrl(), 'eth_blockNumber', []));
    const limit = Math.min(Math.max(1, optInt(a.limit, 'limit') || 64), 256);
    if (/alchemy\.com/.test(getRpcUrl()) && alchKey(getRpcUrl()) && a.fromBlock == null && a.toBlock == null) {
      try {
        const legs = await alchTransfers(getRpcUrl(), aa);
        const by = new Map();
        for (const g of legs) {
          const k = String(g.hash).toLowerCase();
          const r = by.get(k) || { hash: g.hash, block: g.block, ok: true, legs: [] };
          r.block = Math.max(r.block, g.block);
          r.legs.push({ d: g.d, k: g.k, amt: g.amt, p: g.p, sym: g.sym, dec: g.dec });
          by.set(k, r);
        }
        const rows = [...by.values()].sort((x, y) => y.block - x.block).slice(0, limit);
        const lines = [`Activity for ${aa} on ${CHAINS[chain].name}${note} — Alchemy Transfers, newest first, ${rows.length} row${rows.length === 1 ? '' : 's'}`];
        for (const r of rows) {
          const amts = r.legs.map((x) => `${x.d === 1 ? '+' : '−'}${fmtAmt(BigInt(x.amt), x.dec, x.sym || (x.k === 'eth' ? 'ETH' : short(x.k)))}`).join(' · ');
          lines.push(`- block ${r.block} · ${rowTitle(r.legs, r.ok)}${amts ? ` (${amts})` : ''} · ${r.hash}`);
        }
        if (!rows.length) lines.push('No transfers.');
        return lines.join('\n');
      } catch {
        /* logs below */
      }
    }
    let pack;
    const notes = [];
    try {
      if (a.fromBlock != null || a.toBlock != null) {
        const from = optInt(a.fromBlock, 'fromBlock') ?? 0;
        const to = optInt(a.toBlock, 'toBlock') ?? latest;
        if (!(to >= from)) throw new Error('toBlock is before fromBlock.');
        if ((to - from) / (LOGS_RANGE_MAX + 1) > 200) {
          throw new Error('Range too wide for public RPC — narrow fromBlock/toBlock (about 2,000,000 blocks max).');
        }
        pack = await scanRangeLogs(from, to, aa);
      } else {
        pack = await scanAccountLogs(0, latest, aa);
        if (pack.clipped) {
          notes.push(`Showing the recent ~${LOGS_LOOKBACK}-block window. Pass fromBlock/toBlock for an explicit range.`);
        }
      }
    } catch (e) {
      const f = pruneFloor((e && e.message) || '');
      if (f) {
        throw new Error(
          `This node keeps history from ${f > 0 ? `block ${f}` : 'a recent cutoff'} — paste an archive RPC for older blocks.`,
        );
      }
      throw e;
    }
    if (pack.floor) notes.push(`This node keeps history from block ${pack.floor} — an archive RPC reaches older blocks.`);
    const rows = mergeActivity(pack, aa).slice(0, limit);
    const need = new Set();
    for (const r of rows) for (const x of r.legs) if (x.k.startsWith('0x')) need.add(x.k);
    const meta = new Map();
    await Promise.all(
      [...need].slice(0, 32).map(async (t) => {
        meta.set(t, await tokenMeta(t).catch(() => ({ symbol: short(t), decimals: 18 })));
      }),
    );
    const lines = [`Activity for ${aa} on ${CHAINS[chain].name}${note} — newest first, ${rows.length} row${rows.length === 1 ? '' : 's'}`];
    for (const r of rows) {
      const legs = r.legs.map((x) => {
        if (x.k === 'ep') return { ...x, sym: 'prepaid gas', dec: 18 };
        if (x.k === 'eth') return { ...x, sym: 'ETH', dec: 18 };
        const m = meta.get(x.k) || { symbol: short(x.k), decimals: 18 };
        return { ...x, sym: m.symbol, dec: m.decimals };
      });
      const amts = legs.map((x) => `${x.d === 1 ? '+' : '−'}${fmtAmt(BigInt(x.amt), x.dec, x.sym)}`).join(' · ');
      const p = (legs[0] || {}).p;
      const peer = p && legs.every((x) => eq(x.p, p)) ? ` ${legs[0].d === 1 ? 'from' : 'to'} ${short(p)}` : '';
      const gas = r.gas && r.gas !== 0n ? ` · gas ${fmtAmt(BigInt(r.gas), 18, 'ETH')}` : '';
      lines.push(`- block ${r.block} · ${rowTitle(legs, r.ok)}${amts ? ` (${amts})` : ''}${peer}${gas} · ${r.hash}`);
    }
    if (!rows.length) lines.push('No logs in this window.');
    lines.push('', 'Native ETH out and ETH in with calldata leave no log.');
    if (notes.length) lines.push(...notes);
    return lines.join('\n');
  });
}

export function normAssets(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('assets must list at least one { kind, amount }.');
  return raw.map((x, i) => {
    const k = String((x && x.kind) || '').toLowerCase();
    const kind =
      k === 'eth' || k === 'native'
        ? 'eth'
        : k === 'token' || k === 'erc20'
          ? 'token'
          : k === 'deposit' || k === 'ep' || k === 'prepaid'
            ? 'deposit'
            : '';
    if (!kind) throw new Error(`assets[${i}].kind must be eth, token, or deposit.`);
    const amount = String((x && x.amount) ?? '').trim();
    if (!amount) throw new Error(`assets[${i}].amount is required (decimal string, or 'max').`);
    const out = { kind, amount };
    if (kind === 'token') out.token = needAddress(x && x.token, `assets[${i}].token`);
    return out;
  });
}

/** Arbitrary Kernel calls: [{ to, value, data }] — value is decimal ETH or 0x hex wei, data 0x-hex. */
export function normCalls(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('calls must list at least one { to, value, data }.');
  return raw.map((c, i) => {
    const to = needAddress(c && c.to, `calls[${i}].to`);
    const data = needHex((c && c.data) || '0x', `calls[${i}].data`);
    let value = 0n;
    const v = c && c.value;
    if (v != null && String(v).trim() !== '') {
      const s = String(v).trim();
      if (/^0x/i.test(s)) {
        try {
          value = BigInt(s);
        } catch {
          throw new Error(`calls[${i}].value must be decimal ETH or 0x hex wei.`);
        }
      } else {
        value = parseAmt(s, 18);
      }
      if (value < 0n) throw new Error(`calls[${i}].value must be zero or more.`);
    }
    return { to, value, data };
  });
}

/** Pure send plan: caps, amounts, calls. Returns { err } for state blockers, throws for bad input. */
export function planCalls(assets, ctx) {
  const { to, eth, dep, prefund, tokens } = ctx;
  const calls = [];
  const lines = [];
  let ethOut = 0n;
  let epOut = 0n;
  for (const x of assets) {
    if (x.kind === 'token') {
      const t = tokens.get(x.token.toLowerCase());
      if (!t) return { err: `no balance read for token ${x.token}.` };
      const amount = x.amount.toLowerCase() === 'max' ? t.bal : parseAmt(x.amount, t.decimals);
      if (amount <= 0n) return { err: `${t.symbol}: enter an amount above zero.` };
      if (amount > t.bal) {
        return { err: `${t.symbol}: ${x.amount} is more than the account holds (${fmtAmt(t.bal, t.decimals, t.symbol, Infinity)}).` };
      }
      calls.push({ to: x.token, value: 0n, data: encodeTransfer(to, amount) });
      lines.push(`- ${fmtAmt(amount, t.decimals, t.symbol, Infinity)} → ${to} (ERC-20 transfer on ${x.token})`);
      continue;
    }
    if (x.kind === 'eth') {
      const cap = nativeOutValue(eth, prefund);
      const amount = x.amount.toLowerCase() === 'max' ? cap : parseAmt(x.amount, 18);
      if (amount <= 0n) return { err: 'ETH: nothing spendable once the prefund reserve comes out.' };
      if (amount > cap) {
        return { err: `ETH: ${x.amount} leaves no room for the prefund — spendable max is ${fmtAmt(cap, 18, 'ETH', Infinity)}.` };
      }
      ethOut += amount;
      calls.push({ to, value: amount, data: '0x' });
      lines.push(`- ${fmtAmt(amount, 18, 'ETH', Infinity)} → ${to} (native)`);
      continue;
    }
    const cap = epOutValue(dep, prefund);
    const amount = x.amount.toLowerCase() === 'max' ? cap : parseAmt(x.amount, 18);
    if (amount <= 0n) return { err: 'deposit: nothing withdrawable once the prefund reserve comes out.' };
    if (amount > cap) {
      return { err: `deposit: ${x.amount} exceeds deposit − prefund — max is ${fmtAmt(cap, 18, 'ETH', Infinity)}.` };
    }
    epOut += amount;
    calls.push({ to: ENTRY_POINT, value: 0n, data: encodeWithdrawTo(to, amount) });
    lines.push(`- ${fmtAmt(amount, 18, 'ETH', Infinity)} → ${to} (EntryPoint deposit withdrawTo)`);
  }
  return { calls, lines, ethOut, epOut };
}

const PREFUND_COPY = {
  prefund: 'the account needs ETH or prepaid gas for the prefund (AA21 would revert on-chain). Add some, or send less.',
  eth: 'native ETH out leaves too little for the prefund — lower the ETH amount.',
  ep: 'deposit out exceeds deposit − prefund — lower the deposit amount.',
};

async function simulateText(op, eoa) {
  try {
    await jrpc(getRpcUrl(), 'eth_call', [{ from: eoa, to: ENTRY_POINT, data: encodeHandleOps(op, eoa) }, 'latest']);
    return 'eth_call handleOps passed even with the placeholder signature — unexpected; check the validator before signing.';
  } catch (e) {
    const m = (e && e.message) || 'simulation failed';
    if (/AA25/i.test(m)) return 'AA25 — stale nonce. Re-read getNonce and rebuild the draft.';
    if (classifyHandleOpsRevert(m) === 'prefund') {
      return 'AA21 — the account cannot cover the prefund. Add ETH or prepaid gas to the Kernel, or send less.';
    }
    if (/AA23/i.test(m) || classifyHandleOpsRevert(m) === 'sig') {
      return 'eth_call handleOps reaches the signature check and stops there with the placeholder signature (AA23 on this Kernel — its ECDSA validator reverts a bad signature; other stacks return AA24). Nonce and validation passed — the draft is ready to sign.';
    }
    return 'simulation reverted: ' + m;
  }
}

function opJson(op) {
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

async function prepareUserOp(a) {
  const eoa = needAddress(a.eoa, 'owner EOA');
  const chain = normChain(a.chain);
  const hasAssets = Array.isArray(a.assets) && a.assets.length > 0;
  const hasCalls = Array.isArray(a.calls) && a.calls.length > 0;
  if (!hasAssets && !hasCalls) {
    throw new Error('Pass assets (eth/token/deposit send helpers) or calls (arbitrary { to, value, data }) — both land in one UserOp.');
  }
  const assets = hasAssets ? normAssets(a.assets) : [];
  const rawCalls = hasCalls ? normCalls(a.calls) : [];
  return withChain(chain, a, async () => {
    const r = await resolveOnChain(eoa);
    const name = CHAINS[chain].name;
    if (!r.picked.aa) {
      return `This page's factory is not on ${name} yet, and ${eoa} has no live or funded legacy account on this chain — no Kernel path here.`;
    }
    if (!r.picked.deployed) return createText(r, eoa, chain);
    if (!r.execOk) {
      return `The account at ${r.picked.aa} is not a Kernel 0.2.x implementation this wallet sends with (${r.impl || 'unknown'}). Don’t send.`;
    }
    const nLegs = assets.length + rawCalls.length;
    if (nLegs > 1 && !r.batch) {
      return 'This Kernel is 0.2.1 — no executeBatch, one call per UserOp. Re-run with a single asset or call.';
    }
    const aa = r.picked.aa;
    const to = hasAssets ? (a.to ? needAddress(a.to, 'destination') : eoa) : null;
    const needEth = assets.some((x) => x.kind === 'eth');
    const [nonceHex, block, ethHex, depHex, destCode] = await Promise.all([
      call(ENTRY_POINT, encodeGetNonce(aa)),
      jrpc(getRpcUrl(), 'eth_getBlockByNumber', ['latest', false]),
      jrpc(getRpcUrl(), 'eth_getBalance', [aa, 'latest']),
      call(ENTRY_POINT, encodeBalanceOf(aa)),
      needEth ? jrpc(getRpcUrl(), 'eth_getCode', [to, 'latest']) : '0x',
    ]);
    if (hasAssets) {
      const dErr = destError({ dest: to, aa, needEth, destCode });
      if (dErr) throw new Error(dErr);
    }
    const fees = feesFromBlock(block);
    const gas = opGas(nLegs);
    const prefund = requiredPrefund(gas.callGasLimit, gas.verificationGasLimit, gas.preVerificationGas, fees.maxFeePerGas);
    const eth = word(ethHex);
    const dep = word(depHex);
    const tokens = new Map();
    await Promise.all(
      assets
        .filter((x) => x.kind === 'token')
        .map(async (x) => {
          const key = x.token.toLowerCase();
          if (tokens.has(key)) return;
          const [m, balHex] = await Promise.all([tokenMeta(x.token), call(x.token, encodeBalanceOf(aa))]);
          tokens.set(key, { ...m, bal: word(balHex) });
        }),
    );
    const plan = assets.length ? planCalls(assets, { to, eth, dep, prefund, tokens }) : { calls: [], lines: [], ethOut: 0n, epOut: 0n };
    if (plan.err) return `Cannot prepare this UserOp: ${plan.err}`;
    const calls = [...plan.calls, ...rawCalls];
    const ethOut = plan.ethOut + rawCalls.reduce((s, c) => s + c.value, 0n);
    const miss = missingPrefund(eth, dep, ethOut, plan.epOut, prefund);
    if (miss) return `Cannot prepare this UserOp: ${PREFUND_COPY[miss]}`;
    const callData =
      calls.length === 1 ? encodeExecute(calls[0].to, calls[0].value, calls[0].data) : encodeExecuteBatch(calls);
    const op = {
      sender: aa,
      nonce: word(nonceHex),
      initCode: '0x',
      callData,
      ...gas,
      ...fees,
      paymasterAndData: '0x',
      signature: packSudoSignature(DUMMY65),
    };
    const userOpHash = '0x' + (await call(ENTRY_POINT, encodeGetUserOpHash(op))).slice(-64);
    const sim = a.simulate === false ? '' : await simulateText(op, eoa);
    const lines = [
      `Dry-run UserOp draft — ${aa} on ${name} (Kernel ${r.batch ? '0.2.4' : '0.2.1'}). Unsigned until sign_userop.`,
      '',
    ];
    if (hasAssets) lines.push(`To: ${to}`, ...plan.lines);
    if (rawCalls.length) {
      const meta = new Map();
      await Promise.all(
        rawCalls
          .filter((c) => decodeInner(c.data).kind === 'transfer')
          .map(async (c) => {
            const k = c.to.toLowerCase();
            if (!meta.has(k)) meta.set(k, await tokenMeta(c.to).catch(() => null));
          }),
      );
      lines.push(...rawCalls.map((c) => `- ${callLine(c, meta)}`));
    }
    lines.push(
      '',
      `callData (Kernel ${calls.length === 1 ? 'execute' : 'executeBatch'}):`,
      callData,
      '',
      'UserOperation v0.6 draft:',
      opJson(op),
      '',
      `userOpHash: ${userOpHash} — sign_userop packs the signature (session plugin or 0x00000000 ‖ 65-byte owner ECDSA), replacing the placeholder above. The hash does not cover the signature field.`,
      '',
      `Prefund ${prefund} wei (${fmtAmt(prefund, 18, 'ETH')}) = (callGas ${gas.callGasLimit} + verification ${gas.verificationGasLimit} + preVerification ${gas.preVerificationGas}) × maxFee ${fmtAmt(fees.maxFeePerGas, 9, 'gwei')}. EntryPoint takes it from the deposit first, then Kernel ETH. The EOA pays the outer handleOps tx gas itself.`,
    );
    if (sim) lines.push('', `Simulation: ${sim}`);
    lines.push(
      '',
      `Next: sign_userop on this UserOp, then submit_userop (dry_run default). Live handleOps needs live: true plus policy. Human path: ${WALLET_URL}. handleOps to ${ENTRY_POINT}:`,
      encodeHandleOps(op, eoa),
    );
    return lines.join('\n');
  });
}

function decodeInner(data) {
  const h = stripHex(data);
  if (!h) return { kind: 'eth' };
  const sel = h.slice(0, 8);
  if (sel === 'a9059cbb' && h.length >= 136) {
    return { kind: 'transfer', to: '0x' + h.slice(8 + 24, 8 + 64), amount: BigInt('0x' + h.slice(72, 136)) };
  }
  if (sel === '205c2878' && h.length >= 136) {
    return { kind: 'withdrawTo', to: '0x' + h.slice(8 + 24, 8 + 64), amount: BigInt('0x' + h.slice(72, 136)) };
  }
  return { kind: 'raw', selector: '0x' + sel, bytes: h.length / 2 };
}

/** Decode Kernel execute / executeBatch callData into { to, value, data } calls. */
export function decodeCallData(callData) {
  needHex(callData, 'callData');
  return decodeCallDataInner(callData);
}

function numField(v, label) {
  if (v == null || v === '') return 0n;
  try {
    return BigInt(v);
  } catch {
    throw new Error(`${label} must be a number or hex string.`);
  }
}

/** Accept a UserOp object or JSON string; hex or decimal numeric fields. */
export function normOp(raw) {
  let op = raw;
  if (typeof raw === 'string') {
    try {
      op = JSON.parse(raw);
    } catch {
      throw new Error('userOp string must be JSON.');
    }
  }
  if (!op || typeof op !== 'object' || Array.isArray(op)) throw new Error('userOp must be an object.');
  return {
    sender: needAddress(op.sender, 'sender'),
    nonce: numField(op.nonce, 'nonce'),
    initCode: needHex(op.initCode || '0x', 'initCode'),
    callData: needHex(op.callData, 'callData'),
    callGasLimit: numField(op.callGasLimit, 'callGasLimit'),
    verificationGasLimit: numField(op.verificationGasLimit, 'verificationGasLimit'),
    preVerificationGas: numField(op.preVerificationGas, 'preVerificationGas'),
    maxFeePerGas: numField(op.maxFeePerGas, 'maxFeePerGas'),
    maxPriorityFeePerGas: numField(op.maxPriorityFeePerGas, 'maxPriorityFeePerGas'),
    paymasterAndData: needHex(op.paymasterAndData || '0x', 'paymasterAndData'),
    signature: needHex(op.signature || '0x', 'signature'),
  };
}

function callLine(c, meta) {
  const inner = decodeInner(c.data);
  if (inner.kind === 'eth') return `${fmtAmt(c.value, 18, 'ETH', Infinity)} → ${c.to} (native ETH)`;
  if (inner.kind === 'transfer') {
    const m = meta && meta.get(c.to.toLowerCase());
    const amt = m ? fmtAmt(inner.amount, m.decimals, m.symbol, Infinity) : `${inner.amount} base units`;
    return `ERC-20 transfer ${amt} → ${inner.to} on ${c.to}${m ? '' : ' (metadata unread)'}`;
  }
  if (inner.kind === 'withdrawTo') {
    return `EntryPoint withdrawTo ${fmtAmt(inner.amount, 18, 'ETH', Infinity)} → ${inner.to} (prepaid gas out)`;
  }
  return `call ${c.to} value ${fmtAmt(c.value, 18, 'ETH', Infinity)} data ${inner.selector}… (${inner.bytes} bytes)`;
}

async function explainUserOp(a) {
  const hasOp = a.userOp != null && a.userOp !== '';
  const hasCd = typeof a.callData === 'string' && a.callData.trim();
  if (!hasOp && !hasCd) throw new Error('Pass a userOp (object or JSON string) or callData (hex).');
  const op = hasOp ? normOp(a.userOp) : null;
  const callData = op ? op.callData : needHex(a.callData, 'callData');
  const decoded = decodeCallData(callData);
  const lines = [];
  if (op) {
    const pre = requiredPrefund(op.callGasLimit, op.verificationGasLimit, op.preVerificationGas, op.maxFeePerGas);
    const sig = stripHex(op.signature);
    const mode = sig.slice(0, 8);
    lines.push(
      'UserOperation v0.6, read against Kernel 0.2.4 / EntryPoint v0.6:',
      `- sender ${op.sender} · nonce ${op.nonce}`,
      `- initCode ${stripHex(op.initCode) ? 'SET — this wallet sends empty initCode; a set initCode is a different path' : 'empty'} · paymasterAndData ${stripHex(op.paymasterAndData) ? 'SET — no paymaster on this path' : 'empty (no paymaster)'}`,
      `- gas: call ${op.callGasLimit} · verification ${op.verificationGasLimit} · preVerification ${op.preVerificationGas}`,
      `- fees: maxFee ${fmtAmt(op.maxFeePerGas, 9, 'gwei', Infinity)} · maxPriority ${fmtAmt(op.maxPriorityFeePerGas, 9, 'gwei', Infinity)}`,
      `- prefund ${pre} wei (${fmtAmt(pre, 18, 'ETH')}) — EntryPoint takes it from the deposit first, then Kernel ETH`,
      `- signature ${!sig ? 'empty (unsigned draft)' : mode === SIG_SUDO ? 'mode 0x00000000 — ECDSA sudo: the owner EOA signs the userOpHash' : mode === '00000001' ? 'mode 0x00000001 — plugin (session-key validator)' : mode === '00000002' ? 'mode 0x00000002 — enable validator + UserOp' : `mode 0x${mode} — not ECDSA sudo / session plugin / enable`}`,
      '',
    );
  }
  if (decoded.kind === 'other') {
    const inner = decodeInner(callData);
    if (inner.kind === 'transfer' || inner.kind === 'withdrawTo') {
      lines.push(`callData is a raw ${inner.kind}, not wrapped in Kernel execute: ${callLine({ to: '(the called contract)', value: 0n, data: callData })}`);
    } else {
      lines.push(`callData selector ${decoded.selector} is not Kernel execute (0x${EXECUTE_SEL}) or executeBatch (0x${EXECUTE_BATCH_SEL}).`);
    }
  } else {
    let meta = null;
    if (a.chain != null) {
      const chain = normChain(a.chain);
      meta = await withChain(chain, a, async () => {
        const m = new Map();
        await Promise.all(
          decoded.calls
            .filter((c) => decodeInner(c.data).kind === 'transfer')
            .map(async (c) => {
              const k = c.to.toLowerCase();
              if (!m.has(k)) m.set(k, await tokenMeta(c.to).catch(() => null));
            }),
        );
        return m;
      });
    }
    if (decoded.kind === 'execute' && decoded.operation !== 0) {
      lines.push(`callData: Kernel execute with operation ${decoded.operation} — this wallet only sends operation 0.`);
    } else {
      lines.push(`callData: Kernel ${decoded.kind}, ${decoded.calls.length} call${decoded.calls.length === 1 ? '' : 's'}:`);
    }
    decoded.calls.forEach((c, i) => lines.push(`${i + 1}. ${callLine(c, meta)}`));
  }
  lines.push(
    '',
    'Revert hints: AA21 — prefund shortfall (the account needs ETH or prepaid gas). AA23 — validation reverted; not a signature miss. AA24 — signature error; this wallet retries eth_sign after personal_sign. The userOpHash does not cover the signature field.',
  );
  return lines.join('\n');
}

async function walletUrl() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, '..', 'onchain-ui', 'dist', 'index.html');
  const lines = [`Hosted wallet: ${WALLET_URL}`];
  if (existsSync(dist)) lines.push(`Local freeze: ${dist} (same page, opens from disk)`);
  lines.push(
    '',
    'The human opens it with a browser wallet, connects the owner EOA, and creates the Kernel once per chain if missing. Agents may sign and submit handleOps via this MCP when a keystore/session is unlocked under policy. pages.dev remains the human path.',
  );
  return lines.join('\n');
}

function rejectSecrets(a) {
  if (a && (a.passphrase || a.password || a.private_key || a.mnemonic || a.seed)) {
    throw new Error('Do not pass secrets as tool arguments. Use BLACKSMITH_KEYSTORE_PASS or keystore-cli.');
  }
}

async function keystoreTool(a) {
  rejectSecrets(a);
  const action = String((a && a.action) || 'status').toLowerCase();
  if (action === 'status') {
    const s = keystoreStatus();
    const p = loadPolicy();
    return [
      `Owner keystore ${s.onDisk ? 'on disk' : 'missing'} at ${s.path}`,
      s.address ? `- address ${s.address}` : '- none yet — node mcp/keystore-cli.mjs import',
      s.unlocked ? `- unlocked until ${new Date(s.until).toISOString()}` : '- locked',
      `- policy ${p.missing ? 'not found (live still requires dry-run first by default)' : p.path}`,
    ].join('\n');
  }
  if (action === 'unlock') {
    const addr = keystoreUnlock();
    try {
      sessionUnlock();
    } catch {
      /* no session file */
    }
    return `Unlocked owner ${addr} in memory with TTL. Passphrase and key material are not returned.`;
  }
  if (action === 'lock') {
    keystoreLock();
    return 'Owner keystore locked; memory wiped.';
  }
  throw new Error('keystore action must be status, unlock, or lock.');
}

async function sessionTool(a) {
  rejectSecrets(a);
  const action = String((a && a.action) || 'status').toLowerCase();
  if (action === 'status') {
    const s = sessionStatus();
    return `Session keys at ${s.path}: ${s.count} stored, ${s.unlocked ? 'one unlocked' : 'locked'}. Addresses only — no private keys.\n${JSON.stringify(s.active, null, 2)}`;
  }
  if (action === 'create') {
    const rec = sessionCreate({
      targets: a.targets,
      selectors: a.selectors,
      valueLimit: a.value_limit,
      validUntil: a.valid_until,
      unrestricted: a.unrestricted,
    });
    return [
      `Created session key ${rec.address} (encrypted on disk). Private key is not returned.`,
      rec.unrestricted
        ? 'Enable uses merkleRoot 0 (session ECDSA). MCP policy.json still gates live submit.'
        : 'MCP-side target/selector/value limits apply when signing.',
      'Enable on-chain with session action enable (owner unlocked) — Kernel mode 0x00000002, then day-to-day plugin mode 0x00000001.',
    ].join('\n');
  }
  if (action === 'unlock') {
    return `Session ${sessionUnlock(a.session)} unlocked in memory. Private key is not returned.`;
  }
  if (action === 'enable') {
    const chain = normChain(a.chain);
    return withChain(chain, a, async () => {
      const eoa = needAddress(a.eoa, 'owner EOA');
      const r = await resolveOnChain(eoa);
      if (!r.picked.deployed) throw new Error('Kernel must be live before enabling a session key.');
      sessionUnlock(a.session);
      const session = unlockedSession();
      const nonceRaw = String(
        await call(SESSION_KEY_VALIDATOR, '0x7ecebe00' + String(r.picked.aa).replace(/^0x/i, '').toLowerCase().padStart(64, '0')),
      ).replace(/^0x/i, '');
      const lastNonce = BigInt('0x' + nonceRaw.padStart(128, '0').slice(0, 64));
      const sessNonce = lastNonce + 1n;
      const fees = feesFromBlock(await jrpc(getRpcUrl(), 'eth_getBlockByNumber', ['latest', false]));
      const gas = opGas(1);
      const nonceHex = await call(ENTRY_POINT, encodeGetNonce(r.picked.aa));
      const op = {
        sender: r.picked.aa,
        nonce: word(nonceHex),
        initCode: '0x',
        callData: encodeExecute(eoa, 0n, '0x'),
        ...gas,
        ...fees,
        paymasterAndData: '0x',
        signature: packSudoSignature(DUMMY65),
      };
      const signed = await attachEnableSignature(op, chain, r.picked.aa, session, sessNonce);
      return ['Enable-mode UserOp (one-time owner EIP-712 + session personal_sign). Submit via submit_userop.', signedOpJson(signed.op), `userOpHash ${signed.userOpHash}`].join('\n\n');
    });
  }
  if (action === 'revoke') {
    const sk = needAddress(a.session, 'session');
    sessionRevokeLocal(sk);
    if (a.chain == null) return `Removed local session ${sk}. Pass chain and eoa to draft on-chain disable callData.`;
    const chain = normChain(a.chain);
    return withChain(chain, a, async () => {
      const eoa = needAddress(a.eoa, 'owner EOA');
      const r = await resolveOnChain(eoa);
      const callData = encodeExecute(SESSION_KEY_VALIDATOR, 0n, encodeSessionDisableCall(sk));
      return `Local session removed. On-chain disable is a sudo UserOp from ${r.picked.aa}:\n${callData}`;
    });
  }
  throw new Error('session action must be status, create, unlock, enable, or revoke.');
}

async function signUserOpTool(a) {
  rejectSecrets(a);
  const op = normOp(a.userOp);
  const chain = normChain(a.chain);
  return withChain(chain, a, async () => {
    const signed = await signUserOp(op, { signer: a.signer });
    const who = signed.session || signed.owner || signed.signer;
    return [`Signed with ${signed.signer} ${who}. Key material is not returned.`, '', signedOpJson(signed.op), '', `userOpHash: ${signed.userOpHash}`].join('\n');
  });
}

async function submitUserOpTool(a) {
  rejectSecrets(a);
  const op = normOp(a.userOp);
  const chain = normChain(a.chain);
  return withChain(chain, a, async () => {
    const r = await submitUserOp(op, { live: a.live === true, dry_run: a.dry_run, chain, eoa: a.eoa });
    if (r.dry_run) return `Dry-run submit — not broadcast.\nuserOpHash ${r.userOpHash}\nSimulation: ${r.simulation}`;
    return `Live EntryPoint.handleOps submitted.\nuserOpHash ${r.userOpHash}\ntx ${r.txHash}`;
  });
}

const CHAIN_SCHEMA = {
  anyOf: [
    { type: 'integer', enum: [1, 8453] },
    { type: 'string', enum: ['ethereum', 'base', 'eth', 'mainnet', '1', '8453'] },
  ],
  description: 'Ethereum (1) or Base (8453).',
};
const RPC_SCHEMA = {
  type: 'string',
  description:
    'Optional custom RPC URL. When set it is the only URL used — no public fall-through (a dead local fork must not land on live L1). When omitted, an Alchemy key (argument or ALCHEMY_API_KEY) is exclusive JSON-RPC; else the pinned public snapshot is walked.',
};
const ALCH_SCHEMA = {
  type: 'string',
  description:
    'Optional Alchemy API key (or https://…g.alchemy.com/v2/… URL). Exclusive node for this chain plus Portfolio tokens (USD) and Transfers history. Ignored when rpc is set. Defaults to env ALCHEMY_API_KEY.',
};
const ACCOUNT_SCHEMA = {
  type: 'string',
  description: 'Kernel smart account address (0x…). Pass this or eoa.',
};
const EOA_SCHEMA = {
  type: 'string',
  description: 'Owner EOA (0x…). The Kernel is derived at index 0 when account is not passed.',
};

export const TOOLS = [
  {
    name: 'resolve_account',
    description:
      'Resolve the Kernel 0.2.x smart account for an owner EOA on Ethereum or Base, index 0: reconnect a live 0.2.x account at the legacy factory, else this page’s permissionless factory, else the legacy rescue when that address still holds funds. Read-only — creation is a separate EOA transaction signed in the browser wallet.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['eoa', 'chain'],
      properties: { eoa: { ...EOA_SCHEMA, description: 'Owner EOA (0x…).' }, chain: CHAIN_SCHEMA, rpc: RPC_SCHEMA, alchemy: ALCH_SCHEMA },
    },
  },
  {
    name: 'get_balances',
    description:
      'Read the Kernel account’s native ETH, EntryPoint v0.6 deposit, and ERC-20 balanceOf for pasted token addresses or the chain’s pinned majors. State at head over public RPC — no indexer, no prices.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['chain'],
      properties: {
        account: ACCOUNT_SCHEMA,
        eoa: EOA_SCHEMA,
        chain: CHAIN_SCHEMA,
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description: 'ERC-20 addresses to read. Omit to probe the pinned majors (nonzero only).',
        },
      },
    },
  },
  {
    name: 'list_tokens',
    description:
      'Token holdings of the Kernel account. With an Alchemy key: Portfolio API (balances, metadata, USD). Else: majors balanceOf plus optional Transfer-in walk. A clipped walk never claims empty.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['chain'],
      properties: {
        account: ACCOUNT_SCHEMA,
        eoa: EOA_SCHEMA,
        chain: CHAIN_SCHEMA,
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
        tokens: { type: 'array', items: { type: 'string' }, description: 'Extra ERC-20 contract addresses to include.' },
        walk: {
          type: 'boolean',
          description: 'Page ERC-20 Transfer-in logs toward account birth (budgeted on public RPC; deeper on a custom/archive RPC). Ignored when Alchemy Portfolio succeeds.',
        },
        fromBlock: { type: 'integer', description: 'Optional walk floor (e.g. a known birth block).' },
        dust: { type: 'boolean', description: 'When using Alchemy, hide unpriced or sub-$1 tokens (default true).' },
      },
    },
  },
  {
    name: 'get_activity',
    description:
      'Recent account activity. With an Alchemy key: alchemy_getAssetTransfers (ETH in/out including calldata, ERC-20). Else public eth_getLogs. Newest first, cap 256.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['chain'],
      properties: {
        account: ACCOUNT_SCHEMA,
        eoa: EOA_SCHEMA,
        chain: CHAIN_SCHEMA,
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
        fromBlock: { type: 'integer', description: 'Explicit range start. Default: the recent ~120000-block window.' },
        toBlock: { type: 'integer', description: 'Explicit range end. Default: head.' },
        limit: { type: 'integer', description: 'Max rows, newest first (default 64, cap 256).' },
      },
    },
  },
  {
    name: 'prepare_userop',
    description:
      'Build an unsigned UserOp v0.6 from the Kernel: asset send helpers (eth / token / deposit) and/or arbitrary calls [{ to, value, data }] — one leg is Kernel execute, several are executeBatch. Prefund, userOpHash, optional eth_call. Next: sign_userop → submit_userop.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['eoa', 'chain'],
      properties: {
        eoa: { ...EOA_SCHEMA, description: 'Owner EOA (0x…) — resolves the account and is the handleOps sender.' },
        chain: CHAIN_SCHEMA,
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
        to: { type: 'string', description: 'Destination for asset sends. Defaults to the owner EOA.' },
        assets: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'amount'],
            properties: {
              kind: {
                type: 'string',
                enum: ['eth', 'token', 'deposit'],
                description: "'eth' native, 'token' ERC-20 (token address required), 'deposit' EntryPoint deposit withdrawTo.",
              },
              token: { type: 'string', description: 'ERC-20 contract address when kind is token.' },
              amount: {
                type: 'string',
                description: "Decimal amount, or 'max' (native/deposit keep the prefund reserve).",
              },
            },
          },
          description: 'Send helpers. Optional if calls is passed; both combine into one UserOp.',
        },
        calls: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['to'],
            properties: {
              to: { type: 'string', description: 'Call target (0x…).' },
              value: { type: 'string', description: "Native ETH value: decimal string ('0.01') or 0x hex wei. Default 0." },
              data: { type: 'string', description: '0x calldata. Default 0x.' },
            },
          },
          description: 'Arbitrary Kernel calls (any contract, any calldata). Optional if assets is passed.',
        },
        simulate: {
          type: 'boolean',
          description:
            'eth_call handleOps with a placeholder signature (default true). Stopping at the signature check (AA23/AA24) means ready to sign. Never broadcasts.',
        },
      },
    },
  },
  {
    name: 'explain_userop',
    description:
      'Decode a UserOperation v0.6 draft or pasted callData against Kernel 0.2.4: execute/executeBatch legs (native ETH, ERC-20 transfer, EntryPoint withdrawTo), gas fields, prefund, signature mode, and what AA21/AA23/AA24 mean.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userOp: { description: 'UserOperation v0.6 object or JSON string.' },
        callData: { type: 'string', description: 'Raw callData hex when no full UserOp is at hand.' },
        chain: { ...CHAIN_SCHEMA, description: 'Optional — enriches ERC-20 legs with on-chain symbol/decimals.' },
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
      },
    },
  },
  {
    name: 'wallet_url',
    description:
      'The browser wallet URL (hosted freeze, plus local dist). Humans connect there to create the account. Agents can also sign/submit through this MCP under policy.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'keystore',
    description:
      'Owner ECDSA keystore: status, unlock (BLACKSMITH_KEYSTORE_PASS / PASS_FILE, never a chat arg), lock. Memory TTL. Import keys with node mcp/keystore-cli.mjs — not this tool.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['status', 'unlock', 'lock'], description: 'Default status.' },
      },
    },
  },
  {
    name: 'session',
    description:
      'Kernel v2 session keys (EntryPoint v0.6 session-key validator). status / create / unlock / enable (one-time owner sudo enable-mode UserOp) / revoke. Private keys never returned. Preferred signer for agents when permissions cover the call.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['status', 'create', 'unlock', 'enable', 'revoke'] },
        session: { type: 'string', description: 'Session key address for unlock/enable/revoke.' },
        eoa: EOA_SCHEMA,
        chain: CHAIN_SCHEMA,
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
        targets: { type: 'array', items: { type: 'string' }, description: 'MCP-side target allowlist.' },
        selectors: { type: 'array', items: { type: 'string' } },
        value_limit: { type: 'string' },
        valid_until: { type: 'integer' },
        unrestricted: { type: 'boolean' },
      },
    },
  },
  {
    name: 'sign_userop',
    description:
      'Sign a UserOp v0.6: session key when unlocked and permissions cover the call, else owner sudo if unlocked. Returns the packed signature (0x00000000 sudo or 0x00000001 plugin). Never prints private keys.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['userOp', 'chain'],
      properties: {
        userOp: { description: 'UserOperation object or JSON from prepare_userop.' },
        chain: CHAIN_SCHEMA,
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
        signer: { type: 'string', enum: ['auto', 'session', 'owner'] },
      },
    },
  },
  {
    name: 'submit_userop',
    description:
      'eth_call EntryPoint.handleOps, then optionally broadcast. dry_run is the default; live requires live: true, policy.json, and a prior dry-run of the same userOpHash when require_dry_run_first. Owner keystore pays outer tx gas. No bundler. Aborts if the account nonce changed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['userOp', 'chain'],
      properties: {
        userOp: { description: 'Signed UserOperation.' },
        chain: CHAIN_SCHEMA,
        rpc: RPC_SCHEMA,
        alchemy: ALCH_SCHEMA,
        eoa: EOA_SCHEMA,
        live: { type: 'boolean', description: 'Must be true to broadcast. Default false (dry_run).' },
        dry_run: { type: 'boolean' },
      },
    },
  },
];

const HANDLERS = {
  resolve_account: resolveAccount,
  get_balances: getBalances,
  list_tokens: listTokens,
  get_activity: getActivity,
  prepare_userop: prepareUserOp,
  explain_userop: explainUserOp,
  wallet_url: walletUrl,
  keystore: keystoreTool,
  session: sessionTool,
  sign_userop: signUserOpTool,
  submit_userop: submitUserOpTool,
};

/** Returns Markdown text. Throws for bad input or unreachable chain (server marks isError). */
export async function callTool(name, args) {
  const fn = HANDLERS[name];
  if (!fn) {
    const e = new Error(`Unknown tool: ${name}`);
    e.code = -32602;
    throw e;
  }
  return fn(args || {});
}
