# Blacksmith V1 wallet MCP

A zero-dependency stdio MCP server that lets an agent resolve and read the Blacksmith V1 Kernel account (Kernel 0.2.4 / EntryPoint v0.6 on Ethereum and Base), draft a send, and explain a UserOp — then hand the human the browser wallet to connect and sign. A Vulcan public good. MIT, no backend, no token gate.

**Trust boundary.** Every tool is a read or a dry-run draft over public JSON-RPC. The server never asks for, stores, or proxies keys, seeds, or session auth, and never broadcasts a transaction. Creation, signing, and `handleOps` submission stay in the browser wallet. Encoding and RPC failover are the wallet's own (`onchain-ui/kernel.mjs`, `onchain-ui/rpc.mjs`).

## Install (Cursor, about a minute)

No build and no dependencies — Node 20+ (or bun) and a clone of this repo.

1. `git clone https://github.com/eevisceral/blacksmith-wallet.git`
2. Add to `~/.cursor/mcp.json` (Cursor → Settings → MCP):

```json
{
  "mcpServers": {
    "blacksmith-v1-wallet": {
      "command": "node",
      "args": ["/absolute/path/blacksmith-wallet/mcp/server.mjs"]
    }
  }
}
```

With bun instead: `"command": "bun"`, same `args`. Any other MCP stdio client works the same way — point it at `node mcp/server.mjs`.

3. Restart the server from the MCP panel. Ask: "resolve the Kernel account for EOA 0x… on Base".

## Tools

| Tool | What it does |
| --- | --- |
| `resolve_account` | EOA + chain → Kernel address: reconnect a live 0.2.x account, else predict the index-0 create (legacy rescue when that address still holds funds). |
| `get_balances` | Kernel ETH, EntryPoint deposit, ERC-20 `balanceOf` for pasted tokens or the pinned majors. |
| `list_tokens` | Majors probe at head; optional budgeted Transfer-in walk toward birth; pasted addresses. A clipped walk says so. |
| `get_activity` | UserOperationEvent / Transfer / Withdrawn / Received over public `eth_getLogs`, newest first, cap 256. Pruned node → it names the floor block. |
| `prepare_send` | Native / ERC-20 / deposit → Kernel `execute`/`executeBatch` callData + UserOp v0.6 draft + prefund notes + optional `eth_call` simulate. Dry-run only. |
| `explain_userop` | Decode a draft or pasted UserOp against Kernel 0.2.4, with AA21/AA23/AA24 hints. |
| `wallet_url` | The hosted wallet (and local freeze when present) for the human to connect and sign. |

## RPC

Every chain tool takes an optional `rpc` URL. A custom URL is exclusive — it never falls through to a public node, so a dead local fork cannot race onto live L1. Without one, the pinned public Chainlist snapshot in `onchain-ui/kernel.mjs` is walked in order, with the wallet's probe and failover rules. Public scans are budgeted; an archive custom RPC walks deeper.

## Test

From the repo root: `node --test 'mcp/test/*.test.mjs'` (unit + recorded-RPC + a stdio handshake smoke).
