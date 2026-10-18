# Blacksmith wallet MCP

A zero-dependency stdio MCP server for the Blacksmith Kernel wallet (Kernel 0.2.4 / EntryPoint v0.6 on Ethereum and Base). Reads, drafts, **signs UserOps**, and **submits `EntryPoint.handleOps`** under a local policy. MIT, no bundler, no paymaster, no backend.

**Threat model.** Agent hosts are prompt-injection hostile. Private keys, mnemonics, passphrases, and session private keys **never** appear in tool results or logs. Unlock via `BLACKSMITH_KEYSTORE_PASS` (or `BLACKSMITH_KEYSTORE_PASS_FILE` / a TTY when using the CLI) — **not** as a chat-visible tool argument. Memory unlock has a TTL (`BLACKSMITH_UNLOCK_TTL_MS`, default 15 minutes); `keystore` action `lock` wipes it. `submit_userop` is **dry-run unless** `live: true` plus `~/.blacksmith/policy.json` plus an exclusive RPC (tool `rpc` or Alchemy, not the public snapshot).

**Signing.** Two first-class paths: an encrypted **owner keystore** (ECDSA-sudo, the same `0x00000000 ‖ 65-byte` packing the wallet uses) and **Kernel v2 session keys** on the EntryPoint v0.6 session-key validator (`0x5C06CE2b673fD5E6e56076e40DD46aB67f5a72A5`). Agents prefer a session key when it is unlocked and covers the call; owner sudo is the fallback. Encoding stays in `onchain-ui/kernel.mjs`. Direct `handleOps` from the owner EOA — the EOA pays outer tx gas.

## Install (Cursor, about a minute)

No build — Node 20+ (or bun) and a clone of this repo.

1. `git clone https://github.com/eevisceral/blacksmith-wallet.git`
2. Optional owner key: `BLACKSMITH_KEYSTORE_PASS=… BLACKSMITH_IMPORT_KEY=0x… node mcp/keystore-cli.mjs import`
3. Copy `mcp/policy.example.json` to `~/.blacksmith/policy.json` and tighten allowlists.
4. Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "blacksmith-v1-wallet": {
      "command": "node",
      "args": ["/absolute/path/blacksmith-wallet/mcp/server.mjs"],
      "env": {
        "BLACKSMITH_KEYSTORE_PASS": "(unlock only when you intend to sign)",
        "ALCHEMY_API_KEY": "(optional; exclusive JSON-RPC + Portfolio/Transfers like the wallet)"
      }
    }
  }
}
```

Do not put the passphrase in a chat. Omit `BLACKSMITH_KEYSTORE_PASS` until you need to sign; `keystore` action `unlock` reads the env (or pass file) at call time. Auto-unlock on start is intentionally not a thing.

5. Restart the MCP server. Ask: "resolve the Kernel account for EOA 0x… on Base".

## Tools (11)

| Tool | What it does |
| --- | --- |
| `resolve_account` | EOA + chain → Kernel address (legacy reconnect / page factory / rescue) + deployed / nonce / deposit / validators. |
| `get_balances` | Kernel ETH, EntryPoint deposit, ERC-20 `balanceOf`. |
| `list_tokens` | Alchemy Portfolio when a key is set; else majors + optional Transfer walk. |
| `get_activity` | Alchemy Transfers when a key is set; else `eth_getLogs`. Cap 256. |
| `prepare_userop` | Unsigned UserOp v0.6 from asset helpers (eth/token/deposit) and/or arbitrary `calls` `[{ to, value, data }]` — execute or executeBatch. Prefund + optional simulate. |
| `explain_userop` | Decode execute/batch, sudo / plugin / enable modes, AA21/23/24. |
| `wallet_url` | VersionHost + `web3://` + w3link HTTPS. The pin is host `html()`, not a gateway. |
| `keystore` | `status` / `unlock` / `lock`. |
| `session` | `status` / `create` / `unlock` / `enable` (execute, then executeBatch) / `revoke`. |
| `sign_userop` | Session if it covers the call, else owner sudo. |
| `submit_userop` | `eth_call` handleOps; broadcast only with `live: true` and exclusive RPC. Aborts if nonce changed. |

Path: `prepare_userop` → `sign_userop` → `submit_userop` → `submit_userop` with `live: true`. One prepare path: `assets` for sends, `calls` for arbitrary `to`/`value`/`data` (multi-call becomes Kernel `executeBatch`), or both in one UserOp.

## RPC

Same as the wallet: optional `rpc` is exclusive (no public fall-through). Else an Alchemy key (`alchemy` argument or `ALCHEMY_API_KEY`) is exclusive JSON-RPC for that chain plus Portfolio/Transfers. Custom RPC still wins over Alchemy so a local fork cannot race onto live L1. Else the pinned public snapshot. `submit_userop` with `live: true` refuses that public snapshot. Pass `rpc` or Alchemy so the signed `handleOps` tx is not given to a random public node. Dry-run stays allowed on the snapshot. A successful dry-run of the same `userOpHash` is required when `require_dry_run_first` (persisted under `~/.blacksmith/dry-runs.json`). A failed simulation does not count.

## Policy (`~/.blacksmith/policy.json`)

See `mcp/policy.example.json`. A missing file blocks `sign_userop` and live `submit_userop`. `allow_recipients` must list every address (and token contract) the agent may pay. An empty list is refused. `max_native_wei` caps ETH plus EntryPoint `withdrawTo`. `max_erc20` caps `transfer`, `approve`, and `increaseAllowance` per token. Any other inner selector is refused unless `allow_arbitrary_calls` is true. `executeDelegateCall` stays refused. `require_dry_run_first` defaults to true. Override the path with `BLACKSMITH_POLICY`. The example ships with a zero ETH cap and a placeholder recipient. Replace both before a real send.

## Session keys

`session` `create` stores an encrypted key locally and returns **only** the address. `enable` returns two Kernel **mode 0x00000002** UserOps, execute first and executeBatch second. Each installs the session validator for that selector. A limited session's merkle root is the permission tree. An unrestricted session uses merkle root 0. Later sends use plugin mode `0x00000001`. `revoke` drops local material and can draft `disable(bytes)` via Kernel `execute`.

## Test

From the repo root: `node --test mcp/test/*.test.mjs`. Optional live fork: `FORK_RPC=http://127.0.0.1:8545 node --test mcp/test/fork-sign.test.mjs`.
