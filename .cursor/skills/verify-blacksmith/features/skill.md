# Manual

The SKILL.md tab shows the operator manual that is inlined into the page.

## Sub-features

- `skill-open` shows the manual from the landing and from the connected tabs.
- `skill-copy` is disabled only while the manual text is missing. On an idle page it is already enabled.

## How to get to it (user POV)

- On the landing, choose SKILL.md (`#skillOpen`).
- After connect, choose the SKILL.md tab (`#tab-skill`).

## Driving it with Chrome DevTools

Preconditions:

- The page is loaded. Connect is not required for the landing entry.

- **Landing.** Run `document.getElementById('skillOpen').click()`. `#skillView` text contains `Blacksmith V1 wallet`, `EntryPoint`, and `index 0, the only index this page uses`. Placeholders are still `YOUR_EOA_ADDRESS` and `YOUR_SMART_ACCOUNT_ADDRESS`.
- **Connected.** After connect, run `document.getElementById('tab-skill').click()`. The same heading is in `#skillView`. The owner line ends with `(connected account)`. The Kernel line is `(derived from connected)` or `(derived from connected; not deployed on this chain)`.
- **Proof.** The visible article text includes the factory address `0xC1df2Df0C959FE14c453de649591Ac9AD6262Dbf`. On `:8765` the article does not contain `pages.dev`.

## Gotchas

- The freeze (`dist/index.html`, VersionHost) inlines `SKILL.md` as it was at the last pin. The playground at `:8765` fetches repo-root `/SKILL.md`. A source edit that was not restamped shows on the playground and not on the pin. The live pin can still contain `pages.dev` and the older undeployed suffix. For freeze proof, drive the w3link host via `drive-pin.mjs`, not `:8765`.
