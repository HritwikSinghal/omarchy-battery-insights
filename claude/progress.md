# omarchy-battery-insights (fork) -- Progress

## Current state (2026-11-10)

Fork of `aabulkhairov/omarchy-battery-insights` at `8d27d29`, relicensed GPL-3.0-or-later
(upstream and Omarchy MIT notices in `LICENSE.MIT`). It replaces Omarchy's `omarchy.power`
bar widget: the stock battery panel (`Widget.qml` = stock `Panel.qml` + `LOCAL CHANGE`
hunks) plus a HISTORY section (battery level / usage / health behind a dropdown).

All nine plan tasks are done on branch `battery-panel` (plan
`docs/superpowers/plans/2026-11-10-battery-panel.md`): unit tests 39/39, e2e 40/40
(`docs/TESTING.md`). An Opus bug hunt found and fixed 11 issues, each with a test that
failed first. Live-checked on the maintainer's bar: every item of the plan's Task 7
checklist passed; disable restores `omarchy.power` in place.

Installed as `~/.config/omarchy/plugins/hritwiksinghal.battery-insights`, a clone whose
`origin` is still this local checkout (the branch is not on GitHub yet).

## Next actions

1. Maintainer decides on squashing `8d27d29..battery-panel` and pushing; after the push,
   point the installed clone's `origin` at the GitHub fork.
2. Open: the drift notice is acked before it is sent; a send that fails at shell start
   would not be retried for that stock version (unconfirmed, see the plan ledger).
