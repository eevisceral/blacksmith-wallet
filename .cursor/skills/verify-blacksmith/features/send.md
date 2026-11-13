# Send

After connect, To is already the connected wallet. Max checks the ETH row and fills an amount below the Kernel ETH balance. The amount holds back the UserOp prefund and a buffer of 10% of the prefund (at least 1000 wei). The tip is 1 gwei when the base fee is at least 0.05 gwei, and otherwise tracks the base fee. Deposit can cover the prefund. Tokens pay neither. Send stays disabled until the Kernel exists on this chain, the owner wallet has ETH, no send is pending, that row is checked, an amount is set, and To is an address. A one-chain fork hides `#chains`. A dual fork shows Ethereum and Base under the Kernel address. `#chainGo1` and `#chainGo8453` create on the other chain. They are hidden on the one-chain playground.

## Sub-features

- `send-max` checks Max and leaves a gas reserve.
- `send-disabled` leaves `#go` disabled with an empty recipient.
- `send-refuse` stops a send whose Kernel call would revert, before any signature. `#note` reads `This send would fail… Nothing was signed or sent.` and the EOA sends no transaction.
- `send-ok` sends 0.001 ETH on the fork. `#note` reads `Sent.` and the recipient balance grows by exactly 1e15 wei.

## How to get to it (user POV)

- Connect, then stay on the Wallet tab. To (`#dest`) is the connected wallet.
- Choose Max on the ETH row. That checks the row.
- Clear To to see Send go disabled. Use connected wallet puts the address back.
- `#destMe` writes the connected wallet. `#destHint` (Connected wallet) clears To.
- Choose Send (`#go`) only on the fork, and only when the thing under test is the send itself. Never click Send on Ethereum or Base.

## Driving it with Chrome DevTools

Preconditions:

- Connect has already succeeded in this browser session.
- `#ethBal` `dataset.wei` is greater than 0.

- **Max.** Run `document.querySelector('[data-max="eth"]').click()` through `Runtime.evaluate`. Wait until `#amtEth` has a value, `dataset.cap` is not `0`, and `#takeEth` is checked.
- **Reserve.** Read `#amtEth` `dataset.cap` and `#ethBal` `dataset.wei`. The cap is strictly less than the balance.
- **Empty recipient.** Connect fills `#dest`. Clear it and dispatch `input`. `#go` is disabled. A typed amount with the ETH row unchecked does not enable Send.
- **Send on the fork.** Run `node .cursor/skills/verify-blacksmith/drive-send.mjs <evidence-dir>`. It sends 0.001 ETH to the factory (refused, 0 EOA transactions), then 0.001 ETH to `0x4444…` (sent, 1 transaction), then switches the wallet account during the signature (refused with `The network or account changed`, 0 transactions). The network buttons stay disabled while a send runs (`netsLocked`). Proof is `send.json` with `ok` true. It honours `FORK_RPC` and `ONCHAIN_UI_ORIGIN`, so it also runs on the Base fork.
- **Do not broadcast.** Do not click Send against a live chain. On the fork, click Send only when the feature under test is the send itself. `#pendClear` (Clear pending transaction) is hidden when this page has no pending hash. It does not cancel a transaction the wallet already submitted. If the network still has that hash, or the lookup fails, the mark stays.

## Gotchas

- Max reads fees from the fork. If the RPC is still starting, the amount stays empty and the run should fail, not retry against a public node.
- When To is an account whose code starts with `0xef0100`, `#destNote` shows a muted line, only while ETH or Deposit is checked, that sending ETH there runs that code. Send stays enabled. The line is `This account delegates to another contract. Sending ETH here runs that code.`
