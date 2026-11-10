# Testing

**TL;DR**

```sh
test/run.sh                         # unit tests + stock drift check, seconds, no desktop
tests/e2e/smoke.py "$TMPDIR/bie"    # end to end on hidden desktops, a minute or two
```

Then look at the screenshots in the output directory against the checklist below. Both
commands exit non-zero on failure. Neither touches the real desktop's compositor, shell,
bar, notifications or files.

## Unit tests and drift check (`test/run.sh`)

| Suite | Covers |
|---|---|
| `test/model.test.mjs` | upstream `Model.js`: buckets, awake/sleep split, level series, health, formatting |
| `test/ui-state.test.mjs` | `UiState.js`: parsing `ui.json` with field-by-field fallback, serialising, valid values |
| `test/stock-check.test.mjs` | `bin/battery-insights stock-check`: same / changed / absent, notify once per stock version, a malformed sums file |
| `test/sample.test.mjs` | `bin/battery-insights sample` with fake `upower` / `gdbus` on `PATH`: junk lines never wipe the log, the prune, no line reaches bash arithmetic, a reading UPower could not give is skipped |

`.pragma library` files are evaluated in a `vm` context; objects they return come from
another context, so compare them as JSON. After the unit suites, `test/run.sh` runs
`stock-check` against the installed Omarchy: it fails with `STOCK DRIFT` when Omarchy's
power panel no longer matches the copy in `Widget.qml` / `PowerModel.js` (re-sync: copy the
new stock files, re-apply the `LOCAL CHANGE` hunks, update `stock/`), and skips when
Omarchy is not installed.

New logic gets a test that fails on a deliberately broken copy (mutation check), not only
one that passes.

## End to end (`tests/e2e/`)

`tests/e2e/bie` runs a hidden, isolated Omarchy desktop: its own `XDG_RUNTIME_DIR` (Wayland,
Hyprland and shell sockets), its own D-Bus session bus (notifications reach the daemon
inside it), its own `HOME` with `tests/e2e/fixtures/shell.json` (this plugin in the bar where
`omarchy.power` was, `showPercentage` on; lock, idle, `omarchy.battery` and `omarchy.power`
off) and this working tree linked in as the plugin, so uncommitted changes are what gets
tested. A nested Hyprland draws to a 1920x1080 headless output named `E2E`.

UPower and power-profiles-daemon live on the system bus, which is shared with the real
desktop: the test reads them but never presses Enter on a power profile.

Requirements: a running Hyprland session, `qs` with `OMARCHY_PATH` set, `wtype`, `grim`,
`dbus-run-session`, `python3`.

`tests/e2e/smoke.py [OUTPUT_DIR]` runs these sessions, checks the plugin's state
(`omarchy-shell omarchy.power state`) after each step by polling, and fails on any QML error
the shell logs from this plugin's files:

| Session | Checks |
|---|---|
| `panel` | battery present; starts on level / 24h; `shell toggle omarchy.power` (what `SUPER+CTRL+P` runs) opens it; profiles listed; upstream keys `1 2 3 r` do nothing; Right moves the stock profile cursor; Esc closes; IPC `graph` / `range` set the choice, ignore unknown values, write `ui.json`, never `shell.json` |
| `history` | seeded readings (24 h with a charge and a sleep gap, three junk lines) load into the HISTORY section; the picker is the dropdown; each graph and range renders; with a second monitor (two widget copies) a pick lands in `ui.json` once and is not rewritten |
| `first-run-2mon` | two screens from the start and no state directory (a fake `upower` keeps the logger from creating it): a pick made through one widget copy reaches the other (the first screen is removed so the second copy answers `state`) |
| `short-screen` | a 480 px screen: the card is capped, the content scrolls, and the profile cursor scrolls the power profiles into view |
| `persist` | a seeded `ui.json` is restored at shell start |
| `drift` | an edited stock panel (`BATTERY_INSIGHTS_STOCK_DIR`) raises exactly one notification |
| `drift-again` | a restart on the same stock version (seeded `stock-ack`) raises none |
| `drift-send-fails` | with a sender that fails, the version stays unannounced (retried at the next start) |

## Live checks (by hand, on the real bar)

Mouse-only behaviour has no automation here (no pointer tool is installed), and some
checks need real hardware. Run these after installing a change; all passed on 2026-11-10.

| # | Do | Expect |
|---|---|---|
| 1 | Look at the bar | the battery glyph, with the percentage label if `showPercentage` is on |
| 2 | Left-click the icon | the panel: stock header, stats, HISTORY, POWER PROFILE |
| 3 | Right-click, middle-click the icon | nothing happens |
| 4 | `SUPER+CTRL+P` | toggles the panel |
| 5 | Omarchy menu > "Show Battery %" | the label toggles (the item's own text always says "Show") |
| 6 | Dropdown: Usage, Health, Battery level; click outside; Esc while open | the graph follows; outside click and Esc close only the dropdown |
| 7 | After the dropdown: Esc, Tab, arrows | close the panel, next panel, profile cursor |
| 8 | 24 hours / 7 days / 30 days; hover the chart | the range follows; time and value under the chart |
| 9 | Keys `1` `2` `3` `r` | nothing (upstream's keys are gone) |
| 10 | Profiles by click, and by arrows + Enter | the profile switches |
| 11 | Plug or unplug the charger with the panel open | stats stay, the switch shows on the level graph within a minute, charging in green |
| 12 | Pick a graph, `omarchy restart shell` | the pick is still selected |
| 13 | `omarchy plugin disable hritwiksinghal.battery-insights`, then `enable` | `omarchy.power` back in the same slot, then this plugin again |

### Screenshot checklist

| File | Must show |
|---|---|
| `01-open.png` | The battery panel under the bar on the right: battery glyph, "Battery", status line, big percentage, charge bar, the four stats, HISTORY with the dropdown on "Battery level", the POWER PROFILE buttons; the bar button shows the percentage label |
| `02-level-24h.png` | HISTORY on Battery level / 24 hours: the seeded line falls from ~95%, a dotted stretch for the 6 h sleep gap, a rise in the charge colour, then falling again to now; hour labels under it; the six range stats filled |
| `03-level-7d.png` | Same graph over 7 days: day labels, the seeded day at the right end |
| `04-usage-24h.png` | Usage / 24 hours: hourly bars, awake and asleep shades, the "Battery used per hour" caption with the Awake / Asleep legend |
| `05-health.png` | Health: no range row; maximum capacity, design line, health chart from the manufacture date (or the seeded rows) with the 80% line, six health stats |
| `06-short-screen.png` | On the 480 px screen the card ends above the screen edge and its content is cut inside it (it scrolls), not drawn past it |
| `07-short-screen-profiles.png` | Same card scrolled to the bottom: Last charged on its own row, the POWER PROFILE buttons in view with the cursor on one |

`SMOKE_ONLY=history,short-screen tests/e2e/smoke.py OUT` runs only the named sessions.
