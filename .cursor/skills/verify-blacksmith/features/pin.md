# Production pin

The freeze keccak, VersionHost `html()`, and pages.dev bytes are the same string. This is not Connect, Send, or Activity.

## Sub-features

- `pin-live` is `html()` keccak on Ethereum and Base matching the committed freeze.
- `pin-https` is pages.dev keccak matching that freeze, with the landing and inlined manual visible. No wallet.

## How to get to it (user POV)

- Open `https://blacksmith-wallet.pages.dev/`. Heading is Your smart account. Connect wallet is there. SKILL.md opens the inlined manual.
- The on-chain copy is VersionHost `0x885affd4766d70512e35470E82453a9D8aA1D48C` on chain 1 and 8453.

## Driving it with Chrome DevTools

Preconditions:

- Repo-root `.env` may supply `ETH_RPC` / `BASE_RPC`. Public snapshot URLs in `CHAINS` are the fallback.
- Do not click Connect. Do not click Send.

- **Keccak.** `node onchain-ui/dev/pin-check.mjs --live` from the repo root. Both chains show factory live and host live. The pages line keccak equals `0x2d1a9bea0c0af53232f229e8d0f6b13fe1cc1d317a714dd7071158913c3fdd40`.
- **Landing.** `node .cursor/skills/verify-blacksmith/drive-pin.mjs /tmp/blacksmith-verify-evidence/<run-id>`. That script also runs the live pin-check, then opens pages.dev. Proof is `pin.json`.
- **Manual.** After `#skillOpen`, `#skillView` contains `Blacksmith V1 wallet`, `EntryPoint`, and factory `0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf`. `#copySkill` is enabled. `document.body` does not have class `on`.

## Gotchas

- Fork UI at `:8765` serves source `SKILL.md`. It is not this proof.
- Connect on pages.dev needs an injected wallet. That is not this feature. Mark it `verified-unreachable` unless the operator provides one.
- Do not broadcast. The host is already live.