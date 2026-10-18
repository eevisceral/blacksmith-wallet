---
name: verify-blacksmith
description: Drive the Blacksmith V1 wallet page in Chrome against a local Anvil fork and record proof. Use when a change touches onchain-ui UI, send, connect, or the fork playground, and before calling that change done.
---

# Verify Blacksmith

The user surface is the wallet page (`onchain-ui/index.html`). A second surface is the stdio MCP. This skill drives the page. It does not broadcast, and it does not start a second Anvil if one is already on the fork port.

Evidence directory for a run: `/tmp/blacksmith-verify-evidence/<run-id>/`. Cleanup does not delete that directory.

## Launch

From the repo root. One Anvil at a time.

```
node onchain-ui/dev/run.mjs
```

Ready when both are true:

- `curl -sf http://127.0.0.1:8765/` contains `Your smart account`.
- `curl -sf -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545` returns `"result":"0x1"`.

The script reuses an Anvil already bound to `FORK_PORT` (default 8545) if that process answers chain id `0x1`. It seeds a Kernel for Anvil account 0 (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`). Base is a different process: `node onchain-ui/dev/run.mjs base` on `FORK_PORT` / `ONCHAIN_UI_PORT`. Do not run both at once.

Record the `run.mjs` pid in `/tmp/blacksmith-verify-evidence/<run-id>/server.pid` only if this run started it. If the log says `reusing existing process`, do not record that Anvil pid.

## Doctor

Run this before driving. Stop if any line fails.

```
curl -sf http://127.0.0.1:8765/ | grep -q 'Your smart account'
curl -sf -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 | grep -q '"result":"0x1"'
test -x "$(node -e 'import("./onchain-ui/dev/chrome.mjs").then(m=>console.log(m.chromeBin()))')"
```

The third line must print a Chrome binary that exists. `CHROME` overrides the search in `onchain-ui/dev/chrome.mjs`.

## Drive

Chrome is headless, with a fresh user-data dir, remote debugging, and the flags from `chromeArgs` in `onchain-ui/dev/chrome.mjs`. Open `http://127.0.0.1:8765/`. Talk to the page with `Runtime.evaluate` (`awaitPromise: true`, `returnByValue: true`).

Stable handles:

- `#connectLand` is Connect wallet on the landing. After connect, `#connect` is the disconnect chip.
- `#aa` title is the smart-account address after connect.
- `#ethBal` is the ETH balance text. `dataset.wei` is the raw balance.
- `#go` is Send. `#create` is Create account. `#pendClear` is Dismiss stuck transaction.
- `#c1` and `#c8453` are the network buttons (`aria-pressed`).
- `#dest` is the recipient. `#amtEth` and `[data-max="eth"]` are the ETH amount and Max.
- `#tab-activity` and `#tab-skill` switch panels. `#skillView` is the manual.

Connect:

```
node .cursor/skills/verify-blacksmith/drive-connect.mjs /tmp/blacksmith-verify-evidence/<run-id>
```

The script clicks `#connectLand`, waits until `#aa` title is 42 characters and `#ethBal` is not `-`, and writes `connect.json`.

Manual, Max, empty recipient, and Activity, in that order, on a fresh Chrome profile:

```
node .cursor/skills/verify-blacksmith/drive-rest.mjs /tmp/blacksmith-verify-evidence/<run-id>
```

That script writes `rest.json`. It does not click Send. Do not mark a feature verified because a different feature passed.

MCP checks are not a substitute for the page. When the change is only in `mcp/`, run `node --test mcp/test/*.test.mjs` and keep the stdout. That command does not open the page.

## Evidence

Write under `/tmp/blacksmith-verify-evidence/<run-id>/`.

- `connect.json` has the address shown in `#aa` and the ETH balance text.
- `rest.json` has the manual, Max reserve, cleared recipient, activity row count, and connected manual.
- A screenshot is optional. The address plus the balance text is the proof for connect, because the address must equal the legacy factory `getAccountAddress` for Anvil account 0 on this fork.

The proof is the user click and the resulting DOM, not a unit-test assertion alone. `submit_userop` without `live: true` must not call `eth_sendRawTransaction`. The fork smoke does not broadcast to Ethereum or Base.

## Cleanup

Kill only pids this run started: the `run.mjs` pid in `server.pid`, and the Chrome pid printed by `drive-connect.mjs`. Do not kill a reused Anvil. Do not delete `/tmp/blacksmith-verify-evidence/`.

```
if [ -f /tmp/blacksmith-verify-evidence/<run-id>/server.pid ]; then kill "$(cat /tmp/blacksmith-verify-evidence/<run-id>/server.pid)" || true; fi
if [ -f /tmp/blacksmith-verify-evidence/<run-id>/chrome.pid ]; then kill "$(cat /tmp/blacksmith-verify-evidence/<run-id>/chrome.pid)" || true; fi
```

## Helpers

`drive-connect.mjs` is the connect drive. `drive-rest.mjs` is the manual, Max, and Activity drive. Invocation is in Drive.
