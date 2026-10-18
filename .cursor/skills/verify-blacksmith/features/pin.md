# Production pin

The freeze is VersionHost `html()` on Ethereum and Base. This is not Connect, Send, or Activity.

## Sub-features

- `pin-live` is `html()` keccak on Ethereum and Base matching the committed freeze.
- `pin-gateway` is the Ethereum w3link landing with `#hostAddr` filled from the URL. No wallet.

## How to get to it (user POV)

- Open `https://0x885affd4766d70512e35470E82453a9D8aA1D48C.1.w3link.io/`. Heading is Your smart account. `#hostAddr` is the page contract, filled from that URL. Connect wallet is there. SKILL.md opens the manual that was inlined at the last pin. The playground sections The account, This page, and Questions are source copy. They are not what this gateway shows until a new VersionHost is broadcast.
- The same host is `web3://0x885affd4766d70512e35470E82453a9D8aA1D48C` and Base `https://0x885affd4766d70512e35470E82453a9D8aA1D48C.8453.w3link.io/`.

## Driving it with Chrome DevTools

Preconditions:

- Repo-root `.env` may supply `ETH_RPC` / `BASE_RPC`. Public snapshot URLs in `CHAINS` are the fallback.
- Do not click Connect. Do not click Send.

- **Keccak.** `node onchain-ui/dev/pin-check.mjs --live` from the repo root. Both chains show factory live and host live. Host `html()` keccak equals `0x2d1a9bea0c0af53232f229e8d0f6b13fe1cc1d317a714dd7071158913c3fdd40`.
- **Landing.** `node .cursor/skills/verify-blacksmith/drive-pin.mjs /tmp/blacksmith-verify-evidence/<run-id>`. Proof is `pin.json`. `#hostAddr` is `0x885affd4766d70512e35470e82453a9d8aa1d48c`.
- **Manual.** After `#skillOpen`, `#skillView` contains `Blacksmith V1 wallet`, `EntryPoint`, and factory `0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf`. `#copySkill` is enabled. `document.body` does not have class `on`.

## Gotchas

- Fork UI at `:8765` serves source `SKILL.md`. It is not this proof.
- A gateway HTTP body can wrap the freeze. Do not keccak the gateway bytes. The pin is `html()`.
- Connect on the gateway needs an injected wallet. That is not this feature. Mark it `verified-unreachable` unless the operator provides one.
- Do not broadcast. The host is already live.
