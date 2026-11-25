# Security

## What this script touches

- Reads the chess.com board and a few widgets from the current tab.
- Stores settings, the opening memory and the NNUE verdict in `localStorage`.
- Fetches two files from `cdn.jsdelivr.net/gh/ezurinho/chess-wraith@<tag>/vendor`
  and runs them as a blob worker. The tag is pinned; nothing else is fetched.
- Sends nothing anywhere. There is no analytics, no remote config and no account
  data in the script.

The engine executes with chess.com's origin, which is why the mirror is pinned to
a tag: a moving branch would let a third party change what runs on every install.

## Reporting

Open a private security advisory on the repository (Security → Advisories) for
anything that lets a page or another extension reach the panel, the debug API or
the engine URL. Public issues are fine for everything else.

## Scope

Only the latest release is supported. The userscript runs in Tampermonkey-class
managers with `@grant none`; a manager that injects into frames or grants GM_*
APIs is out of scope.
