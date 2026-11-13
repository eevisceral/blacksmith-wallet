# Blacksmith verification map

Read this index, then the feature file. A passing connect run does not verify send, activity, or the manual tab.

## Baseline preconditions

- Fork features use `http://127.0.0.1:8765/` from `node onchain-ui/dev/run.mjs`. Anvil on `http://127.0.0.1:8545` answers chain id `0x1`. The Base fork is `node onchain-ui/dev/run.mjs base` and answers `0x2105`. Run one at a time.
- Production pin checks `html()` at `https://0x49B11598f0b745AcC009c3a70F3fF42e1DCF973c.1.w3link.io/`. No Anvil. `host empty` from `pin-check --live` means this freeze is not deployed, and the command exits 1.
- Doctor in `../SKILL.md` passed for the path you are driving.
- Do not drive an Anvil or page this run did not start, unless Doctor shows the reused Anvil is chain id `0x1` and the page is this repo's UI.

## Driving conventions

- Start from the disconnected landing unless the feature says otherwise.
- Use the element ids in each feature file.
- Run the connect proof with `node .cursor/skills/verify-blacksmith/drive-connect.mjs <evidence-dir>`.
- Run manual, Max, and Activity with `node .cursor/skills/verify-blacksmith/drive-rest.mjs <evidence-dir>`.
- Run the fork send with `node .cursor/skills/verify-blacksmith/drive-send.mjs <evidence-dir>`.
- Run the live pin with `node .cursor/skills/verify-blacksmith/drive-pin.mjs <evidence-dir>`.
- Keep proof files under `/tmp/blacksmith-verify-evidence/<run-id>/`.

## Features

- [Connect](./connect.md) shows the Kernel address after Connect wallet.
- [Send](./send.md) fills Max and refuses a send whose call would revert, and sends on the fork.
- [Activity](./activity.md) opens the activity list. The seeded fork shows rows.
- [Manual](./skill.md) opens the in-page SKILL.md tab.
- [Production pin](./pin.md) checks `html()` keccak on Ethereum and Base, then the w3link landing. `host empty` means this freeze is not deployed.
