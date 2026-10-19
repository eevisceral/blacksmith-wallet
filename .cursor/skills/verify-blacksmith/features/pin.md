# Production pin

The freeze's VersionHost address is checked with `html()` on Ethereum and Base. This is not Connect, Send, or Activity. The address in this file is not proof the host is deployed.

## Sub-features

- `pin-live` is `html()` keccak on Ethereum and Base matching the committed freeze.
- `pin-gateway` is the Ethereum w3link landing with `#hostAddr` filled from the URL. No wallet.

## How to get to it (user POV)

- Open `https://0x15f850670574fB03C751B59726d8A1E411161aCD.1.w3link.io/`. Heading is Your smart account. `#hostAddr` is the page contract, filled from that URL. Connect wallet is there. SKILL.md opens the manual inlined in `dist/index.html`.
- The same host is `web3://0x15f850670574fB03C751B59726d8A1E411161aCD` and Base `https://0x15f850670574fB03C751B59726d8A1E411161aCD.8453.w3link.io/`.

## Driving it with Chrome DevTools

Preconditions:

- Repo-root `.env` may supply `ETH_RPC` / `BASE_RPC`. Public snapshot URLs in `CHAINS` are the fallback.
- Do not click Connect. Do not click Send.

- **Keccak.** `node onchain-ui/dev/pin-check.mjs --live` from the repo root. Both chains show factory live and host live. Host `html()` keccak equals `0x229703c776461c0e1fabdf4b0e5dc995fe83c147b69cfcab8fc9c812b01c0050`.
- **Landing.** `node .cursor/skills/verify-blacksmith/drive-pin.mjs /tmp/blacksmith-verify-evidence/<run-id>`. Proof is `pin.json`. `#hostAddr` is `0x15f850670574fb03c751b59726d8a1e411161acd`.
- **Manual.** After `#skillOpen`, `#skillView` contains `Blacksmith V1 wallet`, `EntryPoint`, and factory `0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf`. `#copySkill` is enabled. `document.body` does not have class `on`.

## Gotchas

- Fork UI at `:8765` serves source `SKILL.md`. It is not this proof.
- A gateway HTTP body can wrap the freeze. Do not keccak the gateway bytes. The pin is `html()`.
- Connect on the gateway needs an injected wallet. That is not this feature. Mark it `verified-unreachable` unless the operator provides one.
- Do not broadcast from this skill. `pin-check.mjs --live` must print `host live` on chain 1 and chain 8453. `host empty` means this freeze is not the contract on that chain. Mark `pin-live` failed. Do not treat the address in this file as proof the host is deployed.
