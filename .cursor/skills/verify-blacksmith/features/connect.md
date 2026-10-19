# Connect

Connect wallet replaces the landing with the Kernel address and an ETH balance.

## Sub-features

- `connect-land` clicks Connect wallet on the disconnected page.
- `connect-address` shows a 42-character account address and an ETH balance that is not `-`.

## How to get to it (user POV)

- Open `http://127.0.0.1:8765/`.
- Choose Connect wallet (`#connectLand`). The header `#connect` is hidden on that landing.
- After connect, `#connect` is the disconnect chip for the owner wallet. It is not a second Connect button. On the disconnected landing it is hidden, except while the SKILL.md tab is open.
- Questions sit on the landing. Which address do people pay? (`aria-controls="ask-4"`) says people pay the address at the top of the asset list on the selected chain, not the owner chip.

## Driving it with Chrome DevTools

Preconditions:

- Doctor passed.
- The page is disconnected (`document.body` does not have class `on`).

- **Open the page.** Load `http://127.0.0.1:8765/`. The heading reads Your smart account and `#connectLand` is present.
- **Question.** The same script opens Which address do people pay? before Connect. `#ask-4` is visible and names the Kernel.
- **Connect.** Run `node .cursor/skills/verify-blacksmith/drive-connect.mjs /tmp/blacksmith-verify-evidence/<run-id>`. The script clicks `#connectLand`.
- **Proof.** `connect.json` in that directory has `ask` containing `Kernel`, `aa` of length 42, and `bal` not equal to `-`. `aa` is `#aa` `title`, the full address. The visible text is shortened. On the seeded Ethereum fork, that title is the Kernel for Anvil account `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`. That address is not the expected `#aa` on the live host. Live connect needs an injected wallet. Without one, mark live Connect `verified-unreachable`.

## Gotchas

- Clicking Connect before `app.mjs` has loaded does nothing. Wait until `#connectLand` exists.
- Do not look for the words Connect wallet on `#connect` after the session starts. The accessible name begins with Disconnect.
- Anvil accounts 0 through 9 on a mainnet fork may be EIP-7702 delegated. The seeded account is still the one the page should show.
- A reused Anvil that is not chain id `0x1` makes the address check meaningless. Doctor catches that.
