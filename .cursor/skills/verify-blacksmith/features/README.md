# Blacksmith verification map

Read this index, then the feature file. A passing connect run does not verify send, activity, or the manual tab.

## Baseline preconditions

- The page is at `http://127.0.0.1:8765/` from `node onchain-ui/dev/run.mjs`.
- Anvil on `http://127.0.0.1:8545` answers chain id `0x1`.
- Doctor in `../SKILL.md` passed.
- Do not drive an Anvil or page this run did not start, unless Doctor shows the reused Anvil is chain id `0x1` and the page is this repo's UI.

## Driving conventions

- Start from the disconnected landing unless the feature says otherwise.
- Use the element ids in each feature file.
- Run the connect proof with `node .cursor/skills/verify-blacksmith/drive-connect.mjs <evidence-dir>`.
- Run manual, Max, and Activity with `node .cursor/skills/verify-blacksmith/drive-rest.mjs <evidence-dir>`.
- Keep proof files under `/tmp/blacksmith-verify-evidence/<run-id>/`.

## Features

- [Connect](./connect.md) shows the smart-account address after Connect wallet.
- [Send](./send.md) fills Max and refuses a send that would take the gas reserve.
- [Activity](./activity.md) opens the activity list. The seeded fork shows rows.
- [Manual](./skill.md) opens the in-page SKILL.md tab.
