# Send

After connect, To is already the connected wallet. Max checks the ETH row and fills an amount below the Kernel ETH balance. The amount holds back the UserOp prefund and a refund buffer. Deposit can cover the prefund. Tokens pay neither. Send stays disabled until the Kernel exists on this chain, the owner wallet has ETH, no send is pending, that row is checked, an amount is set, and To is an address. A one-chain fork hides `#chains`. A dual fork shows Ethereum and Base under the Kernel address. `#chainGo1` and `#chainGo8453` create on the other chain. They are hidden on the one-chain playground.

## Sub-features

- `send-max` checks Max and leaves a gas reserve.
- `send-disabled` leaves `#go` disabled with an empty recipient.

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
- **Do not broadcast.** Do not click Send against a live chain. On the fork, a send is allowed only when the feature under test is the send itself and the recipient is not a 7702 account. `#pendClear` (Clear pending transaction) is hidden when this page has no pending hash. It does not cancel a transaction the wallet already submitted. If the network still has that hash, or the lookup fails, the mark stays.

## Gotchas

- Max reads fees from the fork. If the RPC is still starting, the amount stays empty and the run should fail, not retry against a public node.
- Native ETH to a destination whose code starts with `0xef0100` stops before the wallet prompt.
