# omarchy-battery-insights (fork) -- Progress

## Current state (2026-11-10)

Fork of `aabulkhairov/omarchy-battery-insights` at `8d27d29`, relicensed GPL-3.0-or-later
(upstream and Omarchy MIT notices in `LICENSE.MIT`). It replaces Omarchy's `omarchy.power`
bar widget: the stock battery panel (`Widget.qml` = stock `Panel.qml` + `LOCAL CHANGE`
hunks) plus a HISTORY section (battery level / usage / health behind a dropdown).

Done and on `main` (five commits after `8d27d29`), pushed to the GitHub fork. Unit tests
40/40, e2e 44/44 (`docs/TESTING.md`). An Opus bug hunt and a final review found issues
that are fixed, each with a test that failed first. The live checklist in
`docs/TESTING.md` passed on the maintainer's bar.

Installed as `~/.config/omarchy/plugins/hritwiksinghal.battery-insights`, a clone of the
GitHub fork on `main`: `omarchy plugin update hritwiksinghal.battery-insights` deploys
what is pushed. To deploy local commits before pushing:
`git -C <installed> fetch <this checkout> main && git -C <installed> merge --ff-only FETCH_HEAD`.

## Next actions

None open. Deferred minors (from the final review): the `tests/e2e/bie` header names the
notification-center harness it came from; `state()` carries e2e-only fields without a
note marking them as test hooks.
