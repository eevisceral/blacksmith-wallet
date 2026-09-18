---
name: blacksmith-v1-wallet
description: 'Create or operate a Kernel 0.2.4 account with EOA EntryPoint.handleOps. Reusable operator manual for a contract-hosted wallet. Use when sending from this smart account, reconnecting ECDSA-sudo, creating the index-0 Kernel, or submitting UserOps without a bundler or project ID. Kernel v3 and EntryPoint 0.7 miss this account.'
---

# Blacksmith V1 wallet

This file is the operator manual. A human or an agent can create, reconnect, and send from this Kernel with only a wallet and the chain — no hosted app. It is inlined into the page so a copy fetched from Ethereum still teaches the same path.

Resolve this Kernel from the owner EOA (index 0). Reconnect if that address already has Kernel 0.2.x code this page can send with. New accounts are created on this page’s factory (no owner, no allowlist) with the 0.2.4 implementation. Then send with empty `initCode`. Do not add a bundler, a paymaster, or a hosted Kernel SDK. Do not deploy Kernel v3 or EntryPoint 0.7.

If `onchain-ui/kernel.mjs` is in this repo, use it for encoding. Humans: open this wallet, connect the owner EOA, create if this chain has no account yet, copy the V1 address to receive, pick assets, **Send**.

## Account

- Owner EOA (must sign): YOUR_EOA_ADDRESS
- Smart account: YOUR_SMART_ACCOUNT_ADDRESS
- Chains: Ethereum (1) and/or Base (8453). Same address, separate state per chain. Create once per chain.
- EntryPoint v0.6: `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`
- This page’s factory (create): `0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf`
- Legacy factory (existing accounts): `0x5de4839a76cf55d0c90e2061ef4386d962E15ae3`
- Implementation (new creates): `0xd3082872F8B06073A021b4602e022d5A070d7cfC`
- Older 0.2.x implementations at the legacy factory still send (`execute` `51945447`). 0.2.1 has no `executeBatch` — one asset per send.
- ECDSA validator: `0xd9AB5096a832b9ce79914329DAEE236f8Eea0390`

Blacksmith never held keys. Recovery is reconnect this EOA. UserOps: empty `initCode`, empty `paymasterAndData`. Create is a separate EOA tx to a factory, not a UserOp.

**Resolve:** if the legacy factory `getAccountAddress` (initialize ECDSA + owner, index 0) has Kernel 0.2.x code this page can send with, use it. Else if this page’s factory is on this chain and its `getAccountAddress(owner, 0)` has code, use that. Else if the legacy address has ETH or an EntryPoint deposit and no code, create there so those funds can be used. Else create on this page’s factory. Do not use the legacy factory as the happy path — it has an owner who can disable new creates. If this page’s account is already live and the legacy address still has ETH or a deposit and no code, create that older account too so those funds can be used (you may then have two accounts). When both already have code, keep the one with more ETH+deposit; a tie uses the legacy address. Name the other address; do not switch in the send path.

**Done when:** the resolved address has Kernel 0.2.x code this page can send with (reconnect) or 0.2.4 (create), and a send is an EOA tx to EntryPoint — not v3, not 0.7.

## Send

1. Resolve as above. If `getCode` is empty: this page’s factory → EOA sends `createAccount(owner, 0)`. Rescue → EOA sends legacy `createAccount(implementation, initialize(ECDSA, owner), 0)` only if that factory still allows this implementation; otherwise stop and say the older factory no longer allows this account type. Re-read code. Abort on address mismatch.
2. Read balances: Kernel ETH, ERC-20 `balanceOf(account)`, EntryPoint deposit (`balanceOf(account)` on EntryPoint). Always read Kernel ETH and the deposit before a send — token-only still needs prefund.
3. Build a UserOp v0.6. `callData` is Kernel `execute` / `executeBatch` (selector `0x51945447` / `0x34fcd5be`, operation `0`). Token out is ERC-20 `transfer`. Native ETH is `execute(dest, value, 0x)`. Deposit out is `execute(EntryPoint, 0, withdrawTo(dest, amount))`.
4. Use the amounts entered. Several assets → one `executeBatch` UserOp; one asset → `execute`. Kernel 0.2.1 has no `executeBatch` — send one asset at a time.
5. Prefund: `(callGas + verificationGas + preVerificationGas) * maxFeePerGas`. EntryPoint takes it from the deposit first, then Kernel ETH (`missingAccountFunds`). After that, native value cannot exceed remaining Kernel ETH − buffer (10% of prefund or 0.0001 ETH). Deposit out cannot exceed deposit − prefund. Token-only still needs `Kernel ETH + deposit >= prefund`. Never send the full Kernel ETH or full deposit. Deposit does not pay `execute` value.
6. `userOpHash` from EntryPoint. Sign with the EOA (`personal_sign`). `eth_call` `handleOps` from the EOA before paying for the tx. On AA24 / invalid signature, retry `eth_sign` and simulate again. On AA21, the smart account needs ETH or prepaid gas. AA23 is a validation revert — do not treat it as a signature miss. Signature = `0x00000000` ‖ 65-byte ECDSA.
7. EOA sends `handleOps([op], beneficiary=EOA)` to EntryPoint. The EOA needs ETH for that tx even if the Kernel is rich.

Activity: EntryPoint `UserOperationEvent` (sender = Kernel), ERC-20 `Transfer` to/from the Kernel, EntryPoint `Withdrawn`, Kernel `Received` (plain ETH in). Newest first, cap 256. ETH out and ETH in with calldata have no log.

Discovery: token holdings are state, not history — probe the chain's pinned high-cap token list with `balanceOf(account)` at head first, then add whatever inbound `Transfer` logs reveal. History scans newest-block-down in spans and caches a frontier, so old activity resumes where it stopped instead of restarting. Many nodes prune receipts; a "history is available from block N" error is a floor to clamp to, not a failure — say how far back the node goes and that an archive RPC reaches older blocks.

## RPC

If no user RPC is set, use a public snapshot. Dated 2026-09-17 from `https://chainlist.org/rpcs.json` (do not fetch that file from the page), each probed live for 2023-era receipts: Ethereum `https://gateway.tenderly.co/public/mainnet`, then `https://ethereum-public.nodies.app`, `https://ethereum.public.blockpi.network/v1/rpc/public`, `https://mainnet.rpc.sentio.xyz`, `https://eth.api.pocket.network`. Base `https://base.rpc.sentio.xyz`, then `https://base-public.nodies.app`, `https://base-mainnet.public.blastapi.io`, `https://mainnet.base.org`, `https://gateway.tenderly.co/public/base`. Walk the list in order. A URL must answer `eth_chainId`, `eth_getBalance`, and a one-block unaddressed `eth_getLogs` — do not keep a node that only answers chainId. Prefer nodes that also serve a 2023 block's unaddressed Transfer logs (deep receipts); a node returning zero logs there is lying about pruning. A stall, timeout, or transient relay error skips to the next URL; if every public node stalls, say so and point at the page’s Custom RPC. If a pasted RPC is set, use only that URL — do not fall through to a public node (a dead local fork must not land on live L1). If that URL fails, they paste another or you may recommend a few reputable public options from Chainlist. If every reachable node still refuses old blocks, keep a recent window and say so.

Token discovery is its own walk, not the Activity window: probe the chain's pinned majors with `balanceOf` at head first, then page ERC-20 `Transfer` logs to the account from its birth, newest span first (10000-block spans), on a soft budget — persist the discovered contract addresses and how far the walk got, then resume from there next time. If the walk stops early or every node refuses the old ranges, say older tokens may need a pasted contract address or a custom/archive RPC — never report an empty token list off a clipped scan.

## Selectors

`execute` `51945447` · `executeBatch` `34fcd5be` · `transfer` `a9059cbb` · `withdrawTo` `205c2878` · `getNonce` `35567e1a` · `balanceOf` `70a08231` · `initialize` `d1f57894` · legacy `getAccountAddress` `4d6cb700` · legacy `createAccount` `296601cd` · factory `getAccountAddress` `0d253d76` · factory `createAccount` `5fbfb9cf` · `getUserOpHash` `a6193531` · `handleOps` `1fad948c`

## Agent install

Agents (Cursor, Claude, any MCP client) can do every read in this manual — resolve the account, balances, tokens, activity, a dry-run send draft, a UserOp decode — through the stdio MCP in `mcp/` (zero dependencies, MIT, Node 20+ or bun). Point the client at `node mcp/server.mjs` from a clone of this repo; config and the tool reference are in `mcp/README.md`. The MCP reads chain state and drafts UserOps only: it never holds keys and never broadcasts. Creation, signing, and `handleOps` stay in this wallet — its `wallet_url` tool hands the human the page.
