# omarchy-battery-insights (fork) -- Todo

## Notes & Conventions
- This repo is public: nothing personal in `claude/` or anywhere else (no usernames, home
  paths with names, hardware models, accounts, or the maintainer's other repos and configs).
- Our history starts after upstream's `8d27d29` (BASE). Never rewrite at or below it.
  Commit locally; push only on the maintainer's explicit go.
- `Widget.qml` is Omarchy's stock `Panel.qml` plus hunks marked `LOCAL CHANGE`;
  `PowerModel.js` is the stock `Model.js`, byte for byte. `stock/` records where they came
  from and their hashes; `bin/battery-insights stock-check` says when Omarchy changed them.
  Re-sync = copy the new stock files, re-apply the marked hunks, update `stock/`.
- Develop in this checkout; the installed plugin is a separate clone of the GitHub fork
  (`omarchy plugin update` after a push; fast-forward from here for unpushed commits, see
  `progress.md`).
- Before calling a change done: `test/run.sh`, then the e2e smoke test (`docs/TESTING.md`).

## Open
- [ ] Minor: `state()` (Widget.qml) carries e2e-only fields (keyFocus, screen,
  contentHeight, cardHeight, scrollY, historySamples); mark them as test hooks or move
  them behind a separate verb.
- The battery panel itself is done (design `docs/superpowers/specs/`, plan
  `docs/superpowers/plans/`, both 2026-11-10).
