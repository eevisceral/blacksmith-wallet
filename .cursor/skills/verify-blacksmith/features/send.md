# Send

After connect, To is already the connected wallet. Max checks the ETH row and fills an amount below the balance. Send stays disabled until that row is checked, an amount is set, and To is an address.

## Sub-features

- `send-max` checks Max and leaves a gas reserve.
- `send-disabled` leaves `#go` disabled with an empty recipient.

## How to get to it (user POV)

- Connect, then stay on the Wallet tab. To (`#dest`) is the connected wallet.
- Choose Max on the ETH row. That checks the row.
- Clear To to see Send go disabled. Use connected wallet puts the address back.
- `#destMe` writes the connected wallet. `#destHint` (Your wallet) clears To.
- Choose Send (`#go`) only on the fork, and only when the thing under test is the send itself. Never click Send on Ethereum or Base.

## Driving it with Chrome DevTools

Preconditions:

- Connect has already succeeded in this browser session.
- `#ethBal` `dataset.wei` is greater than 0.

- **Max.** Run `document.querySelector('[data-max="eth"]').click()` through `Runtime.evaluate`. Wait until `#amtEth` has a value, `dataset.cap` is not `0`, and `#takeEth` is checked.
- **Reserve.** Read `#amtEth` `dataset.cap` and `#ethBal` `dataset.wei`. The cap is strictly less than the balance.
- **Empty recipient.** Connect fills `#dest`. Clear it and dispatch `input`. `#go` is disabled. A typed amount with the ETH row unchecked does not enable Send.
- **Do not broadcast.** Do not click Send against a live chain. On the fork, a send is allowed only when the feature under test is the send itself and the recipient is not a 7702 account. `#pendClear` dismisses a stuck local hash. It does not cancel a transaction the wallet already submitted.

## Gotchas

- Max reads fees from the fork. If the RPC is still starting, the amount stays empty and the run should fail, not retry against a public node.
- Native ETH to a destination whose code starts with `0xef0100` stops before the wallet prompt.
