# AGENTS.md

Working notes for agents and humans editing this repo. The README is for users;
this file is for whoever changes the code.

## Commands

```sh
npm ci
npm run build        # src/*.js -> chess-wraith.user.js + .meta.js (ordered concat)
npm run build:check  # fails when the committed bundle is stale
npm run lint         # eslint: no-undef and no-unused-vars are the point
npm test             # node --test "tests/unit/*.test.js"
npm run check        # all of the above, in CI order
node tools/release.js check    # package/header/README badge/CHANGELOG agree
```

## Invariants

1. `src/` is a single IIFE split into fragments that share one lexical scope.
   `tools/build.js` owns the order; a new fragment must be added there or it is
   silently dropped. `npm run build:check` catches a stale bundle, not a missing
   fragment.
2. The version lives in four places (`package.json`, `src/00-header.js`,
   `src/10-config.js`, the README badge) plus the top `CHANGELOG.md` section.
   `tools/release.js check` fails when they disagree; do not hand-edit one.
3. `ENGINE_MIRROR` is pinned to a release tag. Bumping it is part of a release:
   bump the tag, tag the commit, then the mirror resolves.
4. Nothing is written to `window` unless `?cw=1` is in the URL or
   `localStorage['chess-wraith-debug'] === '1'`. Keep it that way.
5. The panel uses `textContent` for anything that came from the page. No
   `innerHTML` with data.
6. The tracker reports `turnCertain: false` when the turn is a guess. Never let
   auto-play, Step or a synthetic click act on a guess.

## Where things are

- `src/30-chess.js` — rules, FEN, SAN, UCI parsing and the tracker. It has a
  `module.exports` guard so tests can `require` it directly.
- `src/40-board.js` — every chess.com selector. Two move-list shapes exist:
  `[data-ply]` nodes and `.node` rows inside `wc-simple-move-list`.
- `src/50-engine.js` — worker lifecycle, UCI, WDL, MultiPV, watchdog.
- `src/90-boot.js` — orchestration and the debug API.
- `tests/unit/` — pure logic. There is no DOM test harness: the board reader is
  verified by hand against the live site, which is the known weak point.

## Gotchas

- Two timers race on purpose: the 2 s scan loop and the debounced board observer.
  `state.thinking` gates the first; the engine watchdog is what unblocks it.
- `settingsChanged` restarts the search; `settingsApplied` only repaints. Mixing
  them up makes a theme click throw away the analysis.
- The analysis board has no clocks and no move list until a game is loaded, so a
  mid-game board there cannot be known: the script refuses to play instead of
  guessing.
- chess.com re-renders the board on every move; `readGridFromBoard` bails on
  `dragging` pieces to avoid a half-empty snapshot.
