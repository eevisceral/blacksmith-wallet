# Production pin

The freeze's VersionHost address is checked with `html()` on Ethereum and Base. This is not Connect, Send, or Activity. The address in this file is not proof the host is deployed.

## Sub-features

- `pin-live` is `html()` keccak on Ethereum and Base matching the committed freeze.
- `pin-gateway` is the Ethereum w3link landing with `#hostAddr` filled from the URL. No wallet.

## How to get to it (user POV)

- Open `https://0x49B11598f0b745AcC009c3a70F3fF42e1DCF973c.1.w3link.io/`. Heading is Your smart account. `#hostAddr` is the page contract, filled from that URL. Connect wallet is there. SKILL.md opens the manual inlined in `dist/index.html`.
- The same host is `web3://0x49B11598f0b745AcC009c3a70F3fF42e1DCF973c` and Base `https://0x49B11598f0b745AcC009c3a70F3fF42e1DCF973c.8453.w3link.io/`.

## Driving it with Chrome DevTools

Preconditions:

- Repo-root `.env` may supply `ETH_RPC` / `BASE_RPC`. Public snapshot URLs in `CHAINS` are the fallback.
- Do not click Connect. Do not click Send.

- **Keccak.** `node onchain-ui/dev/pin-check.mjs --live` from the repo root. Both chains show factory live and host live. Host `html()` keccak equals `0x2d1c79e8eb63a38ba6dac64026b0c76c30c039e2ebf8040cf73c9388061188be`.
- **Landing.** `node .cursor/skills/verify-blacksmith/drive-pin.mjs /tmp/blacksmith-verify-evidence/<run-id>`. Proof is `pin.json`. When the host has no code, the script exits 1 and writes no `pin.json`. `#hostAddr` is `0x49b11598f0b745acc009c3a70f3ff42e1dcf973c`.
- **Manual.** After `#skillOpen`, `#skillView` contains `Blacksmith V1 wallet`, `EntryPoint`, and factory `0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf`. `#copySkill` is enabled. `document.body` does not have class `on`.

## Gotchas

- Fork UI at `:8765` serves source `SKILL.md`. It is not this proof.
- A gateway HTTP body can wrap the freeze. Do not keccak the gateway bytes. The pin is `html()`.
- Connect on the gateway needs an injected wallet. That is not this feature. Mark it `verified-unreachable` unless the operator provides one.
- Do not broadcast from this skill. `pin-check.mjs --live` must print `host live` on chain 1 and chain 8453. `host empty` means this freeze is not the contract on that chain. Mark `pin-live` failed. Do not treat the address in this file as proof the host is deployed.
