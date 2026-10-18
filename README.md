# Blacksmith V1 wallet

Kernel 0.2.4 smart-account wallet (Ethereum and Base) whose UI can live in a contract. Connect the wallet you already use. Create the account once per chain, or reconnect if it already exists. Sends are `EntryPoint.handleOps` from your EOA — no bundler, no project ID, no hosted backend.

[MIT](LICENSE). Agent notes: [AGENTS.md](AGENTS.md). Operator manual: [SKILL.md](SKILL.md) (in-page tab; inlined into the freeze).

Needs **Node 20+**. Freeze rebuild needs **bun 1.2.21** (`.bun-version`; other bun versions change dist bytes). Fork playground and Foundry tests also need **Foundry** (`anvil`, `forge`, `cast`): https://book.getfoundry.sh/getting-started/installation

## Run

Cold clone: install Forge std first (`onchain-ui/contracts/lib/` is gitignored). `run.mjs`, `deploy.mjs`, `deploy-cost.mjs`, and `pin-check.mjs` load a repo-root `.env` if present (they do not override vars already in the shell). The wallet page never reads `.env`. Ethereum fork pin is `ETH_RPC_URL` or `MAINNET_RPC_URL`. Base fork pin is `BASE_RPC` or `BASE_RPC_URL`. Live deploy uses `ETH_RPC` / `BASE_RPC`.

```
# From repo root. Subshell so later commands stay here.
(cd onchain-ui/contracts && forge install foundry-rs/forge-std@v1.16.2 --no-git && forge test -vv)

# Playground: Anvil on :8545, UI on :8765, seeded Kernel.
# Ethereum (default) or Base. One chain per process — stop the other first.
node onchain-ui/dev/run.mjs        # or: npm run dev:fork
node onchain-ui/dev/run.mjs base   # or: npm run dev:fork:base
# http://127.0.0.1:8765/  (both: default :8545+:8765; ETH already up → FORK_PORT=8546 ONCHAIN_UI_PORT=8766)

npm test                           # selfcheck + MCP tests + pin/deploy tests + forge test

# Fork must already be up. smoke-ui wants Chrome (or CHROME).
npm run test:fork

node onchain-ui/dev/deploy-cost.mjs   # live quote using forge-script gas × both chains; may exit 1 if > $5
ETH_RPC=https://… node onchain-ui/dev/deploy.mjs              # simulate (exclusive RPC, no key)
ETH_RPC=https://… node onchain-ui/dev/deploy.mjs --broadcast --account deployer
# Base: BASE_RPC=… node onchain-ui/dev/deploy.mjs --chain base [--broadcast --account deployer]
# Never --private-key. Preflight checks chainId. Broadcast is skipped if this host already serves this keccak. Simulate still runs.
node onchain-ui/dev/pin-check.mjs     # keccak + Deploy/README/kernel pins (no broadcast)
node onchain-ui/dev/pin-check.mjs --live  # Nick/Kernel/EntryPoint + host html() + pages.dev keccak

# Source page needs SKILL.md at /SKILL.md. Use the playground, or open dist/index.html (manual inlined).
# python3 -m http.server -d onchain-ui 8765 does not serve repo-root SKILL.md.
```

The committed `onchain-ui/dist/index.html` **is** the freeze. `node onchain-ui/build.mjs` requires **bun 1.2.21** and refuses to overwrite if minify output drifts. Set `RESTAMP=1` only when you intend a new pin (`forge` required then). Host CREATE2 is hermetic (`bytecode_hash = "none"`).

One Anvil at a time. Ethereum and Base together only in `test:fork` smoke-ui (`:8546` + `baseRpc`).

Connect an injected wallet (EIP-6963, else `window.ethereum`). After Connect, ERC-20s come from chain `Transfer` logs (`eth_getLogs` — no indexer) unless an Alchemy API key is set (header): then the exclusive Alchemy JSON-RPC plus Portfolio (USD) and Transfers APIs are used — no SDK. Optional custom RPC is stored in `localStorage` and is the only URL used when set (no fall-through; it also wins over Alchemy so a local fork stays local). If a custom RPC is unset, a public snapshot is walked. Send needs ETH on the EOA for the outer tx.

## Layout

- `onchain-ui/index.html` + `wallet.css` + `app.mjs` + `kernel.mjs` + `account.mjs` + `gas.mjs` — source page (`kernel.mjs` encodes, `account.mjs` resolves, `gas.mjs` sets UserOp gas; the agent imports the same three; do not add `@zerodev/sdk`)
- `onchain-ui/dest.mjs` — dest / 7702 checks
- `onchain-ui/dist/index.html` — freeze (`SKILL.md` inlined; **6** EIP-170 chunks / **128958** B)
- `onchain-ui/contracts/` — `AccountFactory` (permissionless Kernel 0.2.4 CREATE2) + `VersionHost` (`html()` / `request()`)
- `onchain-ui/dev/` — local fork playground (not in the freeze; serves repo-root `SKILL.md` at `/SKILL.md`)
- `mcp/` — stdio MCP for agents (resolve / balances / tokens / activity / UserOp drafts — sends or arbitrary calls / UserOp decode / keystore + session keys / sign + policy-gated handleOps; not in the freeze)
- `SKILL.md` — operator manual (in-page tab; inlined into the freeze)

Unbundled `index.html` + `app.mjs` needs a static server (`file://` blocks ES modules). Open `dist/index.html` from disk if you want a single file.

## Freeze

```
keccak256(utf8(onchain-ui/dist/index.html)) = 0x2d1a9bea0c0af53232f229e8d0f6b13fe1cc1d317a714dd7071158913c3fdd40
```

VersionHost (CREATE2, Nick factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`; same address on Ethereum and Base; live):

```
0x885affd4766d70512e35470E82453a9D8aA1D48C
```

AccountFactory (same CREATE2 factory and compiler pin; no owner; live):

```
0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf
```

Creation txs (Nick factory). Forge `broadcast/` JSON is local operator log — not in git; verify with `pin-check --live`.

```
Ethereum factory  0xee74493a0e9e83ad497f21e1498c4f1f8c0e87ad54a8bfd4a30f39bbe2491b36
Ethereum host     0x284b7c6a041ffe84da00c06d4069d3dc123fb0dc317f01bf3d66ea450c9a8414
Base factory      0xe8407df5815934db315d75e1e70aadac1a0d6316e99f67c79c75b9659fde879b
Base host         0x2f292c28c33e21ee4ba94813f092ee014323d376244b1bea8e9164a53b2a66b1
```

The pin is `html()` keccak at that host, not a gateway. [blacksmith-wallet.pages.dev](https://blacksmith-wallet.pages.dev/) is HTTPS of the same freeze bytes (keccak must match; `pin-check --live` fetches it). That URL is not the pin. Publish with `wrangler pages deploy onchain-ui/dist --project-name blacksmith-wallet` (not an npm script). Public 5219 gateways call `request()`, not `html()`. VersionHost capacity is 1–16 chunks. Changing inlined `SKILL.md` requires a new host.

Simulate before `--broadcast`. The wrapper in the Run section is the only documented live path. `Deploy.run` also refuses a wrong page hash, a non-Nick factory, chain id other than 1 or 8453, or missing Kernel/EntryPoint. Pin-check `--live` on the same RPCs first. Do not restamp `dist/` after simulate.
