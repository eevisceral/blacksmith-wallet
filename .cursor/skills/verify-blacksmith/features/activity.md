# Activity

The Activity tab lists sends and transfers for the connected owner's Kernel (not the owner wallet itself), or says there is none yet.

## Sub-features

- `activity-open` shows the activity panel.
- `activity-rows` shows list rows for the seeded fork account.
- `activity-empty` shows `Reading this Kernel’s history…` until the first read of this Kernel on this chain finishes, then the empty line only when the list has no rows. If every read of this Kernel failed, it reads `This Kernel’s history could not be read from this RPC. Try again, or paste another RPC in the header.` instead of the empty line.

## How to get to it (user POV)

- Connect.
- Choose Activity (`#tab-activity`).

## Driving it with Chrome DevTools

Preconditions:

- Connect has succeeded.

- **Open Activity.** Run `document.getElementById('tab-activity').click()`. `#panel-activity` is not hidden.
- **Proof.** On the seeded fork, `#hist li` count is greater than 0, `#histEmpty` is hidden, and `#histFork` (Fork) is shown. The empty line, when the list has no rows, reads `No activity yet. Token transfers, sends from this Kernel, and ETH received with no calldata show up here.` Before the first read finishes it reads `Reading this Kernel’s history…`, never the empty line. `rest.json` records `falseEmpty`, sampled every 25ms from the Connect click, and it must be false. A new Kernel on the live host should show that empty line and hide `#histFork`. Without an injected wallet, live Activity is `verified-unreachable`.

## Gotchas

- Activity is hidden until Connect. Driving the tab from the landing does not open the list.
- A fresh `run.mjs` seed transfers tokens to the account, so the list is not empty. An empty line there means the scan found nothing, not that the seed was skipped.
- Scan further (`#histMore`) stays hidden when the scan has no older range left to walk, and also when an Alchemy key is set. On the seeded fork it stays hidden.
- A shallow public node is not this fork. Do not point the page at a public RPC during this run.
