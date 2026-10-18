# Activity

The Activity tab lists sends and transfers for the connected account, or says there is none yet.

## Sub-features

- `activity-open` shows the activity panel.
- `activity-rows` shows list rows for the seeded fork account.
- `activity-empty` shows the empty line only when that list has no rows.

## How to get to it (user POV)

- Connect.
- Choose Activity (`#tab-activity`).

## Driving it with Chrome DevTools

Preconditions:

- Connect has succeeded.

- **Open Activity.** Run `document.getElementById('tab-activity').click()`. `#panel-activity` is not hidden.
- **Proof.** On the seeded fork, `#hist li` count is greater than 0, `#histEmpty` is hidden, and `#histFork` (Local) is shown. The empty line, when the list has no rows, reads `No activity yet. Sends, token transfers, and ETH this account received show up here.`

## Gotchas

- Activity is hidden until Connect. Driving the tab from the landing does not open the list.
- A fresh `run.mjs` seed transfers tokens to the account, so the list is not empty. An empty line there means the scan found nothing, not that the seed was skipped.
- Scan further (`#histMore`) stays hidden when the scan has no older range left to walk.
- A shallow public node is not this fork. Do not point the page at a public RPC during this run.
