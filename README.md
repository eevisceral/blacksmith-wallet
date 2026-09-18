# Blacksmith V1 wallet

Kernel 0.2.4 smart-account wallet (Ethereum and Base) whose UI can live in a contract. Connect the wallet you already use. Create the account once per chain, or reconnect if it already exists. Sends are `EntryPoint.handleOps` from your EOA — no bundler, no project ID, no hosted backend.

[MIT](LICENSE). Agent notes: [AGENTS.md](AGENTS.md). Operator manual: [SKILL.md](SKILL.md) (in-page tab; inlined into the freeze).

Needs **Node 20+**. Freeze rebuild needs **bun 1.2.21** (`.bun-version`; other bun versions change dist bytes). Fork playground and Foundry tests also need **Foundry** (`anvil`, `forge`, `cast`): https://book.getfoundry.sh/getting-started/installation

## Run

Cold clone: install Forge std first (`contracts/lib/` is gitignored). Copy `.env.example` → `.env` if you want a local RPC override.

```
# From repo root. Subshell so later commands stay here.
(cd onchain-ui/contracts && forge install foundry-rs/forge-std@v1.16.2 --no-git && forge test -vv)

# Playground: Anvil on :8545, UI on :8765, seeded Kernel.
# Ethereum (default) or Base. One chain per process — stop the other first.
node onchain-ui/dev/run.mjs        # or: npm run dev:fork
node onchain-ui/dev/run.mjs base   # or: npm run dev:fork:base
# http://127.0.0.1:8765/  (both: default :8545+:8765; ETH already up → FORK_PORT=8546 ONCHAIN_UI_PORT=8766)

npm test                           # selfcheck + forge tests

# Fork must already be up. smoke-ui wants Chrome (or CHROME).
npm run test:fork

node onchain-ui/dev/deploy-cost.mjs   # live quote using forge-script gas × both chains; may exit 1 if > $5

# Static page only (no seed). Stop the playground first — both bind :8765.
python3 -m http.server -d onchain-ui 8765
```

The committed `onchain-ui/dist/index.html` **is** the freeze. `node onchain-ui/build.mjs` requires **bun 1.2.21** and refuses to overwrite if minify output drifts. Set `RESTAMP=1` only when you intend a new pin (`forge` required then). Host CREATE2 is hermetic (`bytecode_hash = "none"`).

One Anvil at a time. Ethereum and Base together only in `test:fork` smoke-ui (`:8546` + `baseRpc`).

Connect an injected wallet (EIP-6963, else `window.ethereum`). After Connect, ERC-20s come from chain `Transfer` logs (`eth_getLogs` — no indexer): the page walks transfers to the account back toward its birth, newest page first, on a soft budget against public RPCs, and `localStorage` remembers both the discovered addresses and how far the walk got. A clipped scan says so — Scan further, paste a contract, or set a Custom RPC for the deep past — instead of claiming the account holds no tokens. If this chain has no Kernel yet, **Create account** is this page’s factory `createAccount(owner, 0)` from the EOA (permissionless, no owner). An existing Kernel 0.2.x at the older factory (same `execute` encoding) is reconnected; 0.2.1 cannot batch — one asset per send. First Ethereum scan can take a while. Optional custom RPC is stored in `localStorage`. If a custom RPC is set, it is the only URL used (no fall-through to a public node). Send needs ETH on the EOA for the outer tx.

## Layout

- `onchain-ui/index.html` + `wallet.css` + `app.mjs` + `kernel.mjs` — source page (`kernel.mjs` is the encoding seam; do not add `@zerodev/sdk`)
- `onchain-ui/dest.mjs` — dest / 7702 checks
- `onchain-ui/dist/index.html` — freeze (`SKILL.md` inlined; **5** EIP-170 chunks / **118387** B)
- `onchain-ui/contracts/` — `AccountFactory` (permissionless Kernel 0.2.4 CREATE2) + `VersionHost` (`html()` / `request()`)
- `onchain-ui/dev/` — local fork playground (not in the freeze; serves repo-root `SKILL.md` at `/SKILL.md`)
- `mcp/` — zero-dependency stdio MCP for agents (resolve / balances / tokens / activity / dry-run send draft / UserOp decode; no keys, no broadcast; not in the freeze)
- `SKILL.md` — operator manual (in-page tab; inlined into the freeze)

Unbundled `index.html` + `app.mjs` needs a static server (`file://` blocks ES modules). Open `dist/index.html` from disk if you want a single file.

## Freeze

```
keccak256(utf8(onchain-ui/dist/index.html)) = 0x4e5ca9176f1a47ebd90aa1f083a8c5d620264f99da2e159bb2d50ba4c042e84b
```

Predicted VersionHost (CREATE2, Nick factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`; same address on Ethereum and Base; **not live** until an operator broadcasts):

```
0x51B0456869ec70568B69669b05399B587Ec86FcB
```

Predicted AccountFactory (same CREATE2 factory and compiler pin; no owner; **not live** until an operator broadcasts):

```
0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf
```

After a host is live, verify with `cast call <host> "html()(string)"` and keccak against the freeze. Pin is that keccak, not a gateway. A convenience copy of this freeze is at [blacksmith-wallet.pages.dev](https://blacksmith-wallet.pages.dev/); that is not verification. Public 5219 gateways call `request()`, not `html()`. VersionHost capacity is 1–16 chunks. Changing inlined `SKILL.md` requires a new host.

Default deploy path is simulate-only (`node onchain-ui/dev/deploy-cost.mjs`). Do not `--broadcast` unless you mean to pin a live host.
