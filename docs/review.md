# Review, 1.58.0

Written after the 1.58.0 arrow overlay. Evidence is the suite output and the
files, not a feeling; where the evidence is thin it says so.

## Grade

| Area | Grade | Why |
| --- | --- | --- |
| Product | 8.0 | It does what almost no public script does: strength anchored to the account's own published rating, per-account pacing, AFK rematch, a report and a stats tab. The overlay closed the last visible gap against the 2026 scripts. |
| Engineering | 8.5 | One IIFE, 15 fragments, 210 tests over 24 files, a jsdom bench that boots the whole bundle, a release script that refuses to tag a red check. The weak spot is that the live path is not exercised. |
| Verification | 6.5 | Unit and boot coverage are real. There is no automated run against a live rated game, and `session.test.js` failed twice in six full-suite runs under load at the `gameOverSeen` assertion, then passed in isolation and in the next two full runs. An intermittent failure with no root cause is a debt, not a detail. |
| Honesty | 9.0 | The README states the floor, the risk and the limits; no telemetry, no remote engine, no deliberate-miss dice. The new review keeps that tone. |
| UX | 7.5 | Dense but legible at 300 px; four tabs now. The board overlay is the first thing that reads without the panel. No mobile layout. |
| Risk (as a cheating tool) | 3.0 | chess.com reports ~314,000 closure decisions in one quarter and says most are automated, over 100 gameplay factors. Pacing and a rating-matched band lower the obvious signals; they do not make the account safe. |

**Overall: 7.6/10.** A well-built tool with unusually honest documentation, held
back by unverified live behaviour and one unexplained test flake.

## What is strong

- The rating chain has a single owner (`resolveElo`) and the panel exposes every
  link: page, account, prior, floor, default. The 133-vs-1245 case is now a
  documented outcome instead of a mystery number.
- The loss ledger is measured when the position after the move is evaluated, not
  guessed when the move lands, so the report cannot count the same swing twice.
- One place paints the overlay (`refreshPanel`), so the toggle, a new game and a
  re-analysis all converge on the same state.
- The release process is a gate, not a checklist.

## What is weak, in priority order

1. **No live-game verification.** Nothing in CI loads chess.com and plays a
   rated move. The selectors, the modal, the arrow geometry and the pacing are
   proven in jsdom, which is not the same page.
2. **The `gameOverSeen` flake.** Twice in six loaded runs the rematch press
   succeeded and the flag was already false at the next assertion. `onNewGame`
   is the only writer, and it only runs on a changed board, so either the
   fixture's board changed under load or a second scan saw a new-game state.
   Until it is caught in the act, the suite can go red on a good commit.
3. **Overlay geometry assumes the board element is exactly the eight-by-eight
   grid.** chess.com draws its coordinates inside the same box, so this is true
   today. A theme that adds a margin would shift every arrow by the margin.
4. **The overlay is not clipped.** `overflow: visible` is deliberate for the
   head, but a bad cell would draw outside the board instead of being cut.
5. **`refreshPanel` is called from many paths.** The overlay's signature check
   makes it cheap, but the function now does rendering and page mutation; a
   future caller that expects it to be pure will be surprised.
6. **History is capped at 20 with no export.** The copy-report text carries the
   last game only.
7. **The panel is 300 px wide by default and has no compact mode below that.**
8. **First run still downloads 1.2 MB of engine.** Cached afterwards, but the
   first game on a cold profile waits.

## What the next release should do

- Turn the flake into a reproduction: log the board FEN and `gamesPlayed` at the
  assertion, run the session test ten times in a loop in CI.
- Add one manual live checklist to `docs/` with the exact page states to try.
- Clip the overlay to the board and derive the cell size from the board rect
  rather than assuming 1/8.
