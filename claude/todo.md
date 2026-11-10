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
- Develop in this checkout; the installed plugin is a separate clone that is fast-forwarded
  from it (exact commands: plan Task 7, `docs/superpowers/plans/2026-11-10-battery-panel.md`).
- Before calling a change done: `test/run.sh`, then the e2e smoke test (`docs/TESTING.md`).

## Open
- [ ] `battery-panel`: implemented, bug-hunted, live-checked and installed; waiting on the
  maintainer's call on squash + push (then repoint the installed clone's `origin`). Plan
  `docs/superpowers/plans/2026-11-10-battery-panel.md`, spec
  `docs/superpowers/specs/2026-11-10-battery-panel-design.md`; per-task ledger (rulings)
  in `.superpowers/sdd/2026-11-10-battery-panel/progress.md` (git-ignored, local).
- [ ] Drift notice: acked before sending, so a send that fails at shell start is never
  retried for that stock version. Unconfirmed; fix only if seen (ack after a successful
  `omarchy-notification-send`).
