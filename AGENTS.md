# Contributor notes

This repository is the Blacksmith V1 wallet (vanilla HTML). There is no Next.js app.

## Product

Treat the UI as a lasting public-good wallet (`onchain-ui/` HTML that can live in a contract): create the Kernel once on this chain if none exists, otherwise keep using it. Prefer EOA `EntryPoint.handleOps` over third-party bundlers. Do not frame it as a one-shot send tool or a hosted page with an end date.

Keep `SKILL.md` at the repo root as an in-page tab (do not drop it from the UI to save bytecode; do not keep a second copy under `onchain-ui/`). Write it as a reusable operator manual for contract-hosted wallets — word it generally (do not name ZeroDev or bundler replacement). When filling addresses, label them `(connected account)` vs `(derived from connected)` and handle a missing derived AA with clear UX. If a pasted RPC fails, the user pastes another, or you may recommend public options from `https://chainlist.org/rpcs.json`. The disconnected landing is title (**Your smart account**) + lede + Connect + SKILL.md, then **The account** / **This page** / **Questions**. Wallet / Activity stay behind Connect. This page fills the host address from the gateway/`web3://` URL, or from `PAGE_HOST` in `kernel.mjs` after broadcast.

Connected chrome is session (brand + compact Ethereum/Base + custom RPC + EOA chip), then Wallet / Activity / SKILL.md tabs. The Kernel address is a badge on the left of the Wallet list toolbar (copy + explorer inline), opposite Select all; custom token add is the last row in the token list (sticky while the list scrolls). Custom RPC sits beside the network control and uses the same pressed treatment as Select all when a custom URL is active. Feedback goes through toasts (click to dismiss). The Connect chip asks before disconnect.

Visual direction: wallet wells stay beveled; landing is editorial; tangerine/forge accent is Connect/Send/Create, selected tab, and links only. Mono for brand, landing title, kickers, tabs, addresses, and the skill listing. Keep side gutters; do not cap the shell as mobile-only. Do not inline OS skins, webfonts, or a desktop metaphor into `html()`.

Do not expose EntryPoint deposit as a manual user action; reserve `requiredPrefund` automatically in the send path. To defaults to the connected EOA; amounts default to spendable max (still editable); batch UserOps when multiple calls are needed except on Kernel 0.2.1 (no `executeBatch`). Select-all and Max share the same spendable cap. Do not commit `.env`, dumps, or backup files.

## Architecture

- Kernel 0.2.4 / EntryPoint v0.6 encoding lives in `onchain-ui/kernel.mjs`. Do not add `@zerodev/sdk`. New accounts: EOA `AccountFactory.createAccount(owner, 0)` (permissionless, pinned impl/ECDSA). Existing Kernels at the legacy factory are reconnected if they are 0.2.x with the same `execute` encoding (0.2.1 has no `executeBatch` — one asset per send; 0.2.2+ batch). That factory is rescue-only if its predicted address already holds ETH. UserOps stay empty `initCode`. Not Kernel v3, not EntryPoint 0.7, no implementation picker, no in-page upgrade.
- V1 AA is ECDSA-sudo to the user’s EOA. Recovery is reconnect-the-EOA.
- Native ETH and EntryPoint deposit sends must reserve `requiredPrefund` (Kernel ETH always; deposit withdraws `deposit - prefund`).
- Custom RPC must be tried before any public URL so a local fork cannot race onto live L1. If a custom RPC is set and fails, do not fall through to a public node. Public list is a Chainlist snapshot pinned in `CHAINS` (Tenderly / 0xRPC / Sentio / Pocket on Ethereum; Sentio / Pocket / `mainnet.base.org` on Base). Pick the first URL that answers chainId, balance, and a one-block unaddressed `eth_getLogs`. Mid-scan, walk remaining public URLs then page `eth_getLogs` (max 10000-block inclusive spans). Do not fetch `chainlist.org/rpcs.json` from the freeze.
- `web3://` / w3link / Freedom are optional clients, not the pin (keccak of `html()`). Do not strip page RPC or fail-closed custom for Freedom `connect-src 'none'`. Public 5219 gateways call `request()`, not `html()`.
- Token holdings and activity come from onchain Transfer logs plus ERC-20 `name`/`symbol`/`decimals` and the token address — no indexer, price APIs, or DEX quotes. Activity also reads EntryPoint `UserOperationEvent` / `Withdrawn` and Kernel `Received` (plain ETH in); newest first, cap 256. Native ETH out and ETH in with calldata have no logs. If the node cannot serve the requested from-block, say that history is recent-only.
- Local fork: `npm run dev:fork` / `node onchain-ui/dev/run.mjs` (Ethereum) or `npm run dev:fork:base` / `node onchain-ui/dev/run.mjs base` (Base). One Anvil at a time. UI at `:8765`. Dual Anvil is only for `test:fork` smoke-ui Base switch.
- Freeze: `node onchain-ui/build.mjs` → `onchain-ui/dist/index.html` (**5** EIP-170 chunks / 104283 B; keccak in the README Freeze section). Minify pin is **bun 1.2.21**. `SKILL.md` is inlined. Foundry under `onchain-ui/contracts/` (`bytecode_hash = "none"`). Host and AccountFactory are CREATE2 (Nick factory) so Ethereum and Base share addresses. A skill edit on a live host needs a new VersionHost. No mainnet VersionHost until an operator broadcasts.
- A hosted copy of the freeze may be served at `https://blacksmith-wallet.pages.dev/`. That URL is convenience HTTPS, not the on-chain pin.
