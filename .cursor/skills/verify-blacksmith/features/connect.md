# Connect

Connect wallet replaces the landing with the smart-account address and an ETH balance.

## Sub-features

- `connect-land` clicks Connect wallet on the disconnected page.
- `connect-address` shows a 42-character account address and an ETH balance that is not `-`.

## How to get to it (user POV)

- Open `http://127.0.0.1:8765/`.
- Choose Connect wallet (`#connectLand`). The header `#connect` is hidden on that landing.
- After connect, `#connect` is the disconnect chip for the personal wallet. It is not a second Connect button.

## Driving it with Chrome DevTools

Preconditions:

- Doctor passed.
- The page is disconnected (`document.body` does not have class `on`).

- **Open the page.** Load `http://127.0.0.1:8765/`. The heading reads Your smart account and `#connectLand` is present.
- **Connect.** Run `node .cursor/skills/verify-blacksmith/drive-connect.mjs /tmp/blacksmith-verify-evidence/<run-id>`. The script clicks `#connectLand`.
- **Proof.** `connect.json` in that directory has `aa` of length 42 and `bal` not equal to `-`. On the seeded Ethereum fork, `aa` is the legacy factory `getAccountAddress` for `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`. That address is not the expected `#aa` on the live host. Live connect needs an injected wallet. Without one, mark live Connect `verified-unreachable`.

## Gotchas

- Clicking Connect before `app.mjs` has loaded does nothing. Wait until `#connectLand` exists.
- Do not look for the words Connect wallet on `#connect` after the session starts. The accessible name begins with Disconnect.
- Anvil accounts 0 through 9 on a mainnet fork may be EIP-7702 delegated. The seeded account is still the one the page should show.
- A reused Anvil that is not chain id `0x1` makes the address check meaningless. Doctor catches that.
