# Battery panel: the stock power panel plus battery history -- design

Status: approved by the maintainer (2026-11-10). Fork of
`aabulkhairov/omarchy-battery-insights` at `8d27d29`.

## TL;DR

Turn this fork into a drop-in replacement for Omarchy's built-in `omarchy.power` bar widget.
The panel keeps everything the stock battery panel shows and does, power-profile switcher
included, and adds one HISTORY section between the battery stats and the power profiles. A
dropdown in that section picks one of three graphs: Battery level (charge % over time, the
main reason this exists), Usage (battery used per hour or per day, awake vs asleep), or
Health (capacity over the battery's life). The logger and the three charts already exist in
upstream Battery Insights; the stock panel content is copied from Omarchy. The fork declares
`"omarchy": { "clonedFrom": "omarchy.power" }` so every caller of the built-in id reaches it.

## Intent

The maintainer wants an Android-style battery graph: open the battery panel, see how the
charge level moved over the last day or week, without giving up anything the stock panel
offers. A separate bar button (upstream Battery Insights' layout) is not wanted; the graph
belongs in the battery panel itself.

## Goals

1. One battery widget in the bar. Its button and panel behave like `omarchy.power` today,
   plus the HISTORY section, minus the right-click percentage toggle.
2. Battery level graph: charge % over 24 hours, 7 days, or 30 days; charging drawn in the
   theme's green; time asleep or powered off drawn dotted; hover shows time, %, and state.
3. Usage graph and Health graph from upstream, available through the same dropdown.
4. Each graph keeps a short stats block under it (see "HISTORY section").
5. History is never empty on first install: the logger's existing UPower backfill fills it.
6. When Omarchy changes its stock power panel, the fork notices and says so instead of
   silently drifting.

## Non-goals

- New system metrics. CPU-vs-rest-of-machine watts (RAPL `psys`/`package`), battery
  temperature, charger wattage, logging the power profile or screen brightness per sample:
  all considered, all deferred. Nothing in this design should make them harder to add later.
- Per-app battery attribution (needs root or guesswork).
- Changing charge thresholds or vendor charge modes (needs root).
- Translations beyond English for the new strings.
- Upstreaming to `aabulkhairov/omarchy-battery-insights` or to Omarchy.

## Anti-goals (a failure even if it works)

- Losing any stock behaviour other than the right-click percentage toggle (dropped on
  purpose, see "Keyboard and mouse"): the bar icon and its optional percentage label,
  `SUPER+CTRL+P`, the hero line with its rotating phrases, the charge bar and its charging
  pulse, the four stats (size, cycles, time left / to full / charge limit, rate / holding),
  the power-profile buttons with mouse and keyboard selection, Esc to close, Tab between
  panels.
- Writing to `shell.json` on every dropdown or range change (that file is often kept in a
  dotfiles repo; churning it is noise).
- Extra background cost beyond upstream's one helper run per minute.
- Two battery widgets in the bar, or the stock one coming back after a shell restart.

## Constraints

- Omarchy 4 (Quattro) shell, Quickshell/QML, plugin manifest `schemaVersion` 1.
- Plugins run unsandboxed inside the shell: every `Text` uses `textFormat: Text.PlainText`
  (upstream already does); no network access; no sudo.
- Motion follows the shell's rules: `Style.duration(ms)`, ease-out, nothing on the
  dropdown switch itself beyond what the kit component does.
- Never edit `/usr/share/omarchy/`; the stock panel is copied, not patched in place.
- New source files are ASCII; glyphs and typographic characters in new code are written as
  `\uXXXX` escapes. Files copied verbatim (stock `Panel.qml`/`Model.js`, upstream files)
  keep their bytes.
- Public repo: no personal details (usernames, hardware models, home paths) in code, docs,
  or `claude/`.

## Decided by the maintainer

- Base: this fork of Battery Insights, developed in its own checkout; the installed copy
  under `~/.config/omarchy/plugins/` is a separate clone that is fast-forwarded.
- Replace `omarchy.power`; keep all of its information and the power-mode switcher.
- All three graphs, one visible at a time, chosen with a dropdown.
- Layout A: HISTORY sits between the stats row and the POWER PROFILE section.
- Plugin id `hritwiksinghal.battery-insights` (distinct from upstream's id).
- Graph picker: try the kit dropdown first; if it cannot be made solid inside the panel,
  fall back to a row of three buttons and tell the maintainer.
- No plugin-specific keyboard shortcuts: the graph and range are picked with the mouse
  only. The stock panel's keys stay (Esc, Tab, arrows/hjkl + Enter on power profiles).
- Right-click and middle-click on the bar button do nothing; left-click toggles the panel.
- After implementation: a bug hunt, then a README rewrite; the fork is GPL-3.0-or-later.

## Design

### Identity and replacing `omarchy.power`

- Manifest id becomes `hritwiksinghal.battery-insights` (upstream's is
  `aabulkhairov.battery-insights`; `omarchy-plugin-add` refuses an id already installed, and
  the marketplace could not tell the two apart). Kinds stay `service` + `bar-widget`; add
  `"omarchy": { "clonedFrom": "omarchy.power" }`. The state directory name stays
  `battery-insights`, so logs written by upstream carry over.
- Inside the widget, the IPC target is the built-in id `omarchy.power`, as `omarchy plugin
  clone` does for its clones; upstream's own target (`aabulkhairov.battery-insights`) is
  dropped. (`moduleName` needs no such care: the bar overwrites it
  with the layout entry id at load, `plugins/bar/Bar.qml`.) `PluginRegistry.resolveEnabledId()`
  (`/usr/share/omarchy/shell/services/PluginRegistry.qml:171`) routes `omarchy.power`
  callers to an enabled manifest that declares it in `clonedFrom`, so `SUPER+CTRL+P`
  (`{ panel = "omarchy.power" }` -> `omarchy-shell shell toggle omarchy.power`) and
  `omarchy-shell omarchy.power togglePercentage` reach this plugin with no keybinding edit.
- IPC verbs: the stock set (`open close show hide toggle togglePercentage`) plus upstream's
  `range <24h|7d|30d>` and a new `graph <level|usage|health>`; both new verbs open the panel.
- Install and removal need no code of ours; the shell already does the swap for any manifest
  with `clonedFrom` (read in source, `PluginRegistry.qml`): `omarchy plugin add <url>
  --enable` replaces the `omarchy.power` bar entry in place and copies its settings
  (`showPercentage` included, lines 556-563), and because this plugin also has a `service`
  kind it adds `omarchy.power` to `disabledPlugins` and records a restore (580-582).
  `omarchy plugin disable` or `remove` runs `restoreCloneSource` (459-491), which puts the
  `omarchy.power` entry back in the same slot with its settings. `omarchy plugin update` is
  a fast-forward fetch. Do not hand-edit `shell.json` or use `omarchy bar` to swap: that
  bypasses the restore bookkeeping.
- Upstream's separate bar button (chart glyph, right-click watts toggle, middle-click
  refresh) is dropped; the stock battery button (level- and charge-aware glyph, optional
  percentage label) replaces it. The `showRate` setting goes. The `showPercentage` setting
  and the `togglePercentage` IPC verb stay (the Omarchy menu uses the verb), but
  right-click no longer calls it.

### Panel layout (A)

Top to bottom, identical to stock except the dashed part:

1. Hero: battery glyph, "Battery" title, rotating status phrase, big percentage.
2. Charge bar (pulses while charging).
3. Stats row: battery size, charge cycles, time left / to full / charge limit, rate / holding.
4. Separator.
5. HISTORY section (new) -- see below.
6. Separator.
7. POWER PROFILE header and buttons.

Panel width stays the stock width unless the charts are unreadable at it; then the builder
may widen it (upstream used `Style.space(460)`, stock uses `Style.space(380)`). The panel
scrolls (upstream's `Flickable`) only if its content exceeds the available height.

### HISTORY section

- Header row: `PanelSectionHeader` "HISTORY" on the left, the kit `Dropdown` (qs.Ui) on the
  right with options Battery level / Usage / Health. Default: Battery level.
- The dropdown is built as a spike first. Known risk (from source): `Ui/Dropdown.qml` is a
  QtQuick.Controls `Popup` that no `KeyboardPanel`-based plugin uses yet; the panel's
  `PanelKeyCatcher` takes j/k/Enter/Space before the trigger sees them, and the popup lives
  in the window overlay outside the catcher. The picker is mouse-only, so keyboard
  operation of the dropdown is not required, but the spike must show: mouse
  open/select/close, clicking outside the popup closes it, no stock key (Esc, Tab, arrows,
  Enter) does something wrong or leaves the popup orphaned while it is open, and the popup
  closes when the panel closes. If any of that cannot be made reliable, replace the
  dropdown with a second `ButtonGroup` row (Level / Usage / Health) styled like the range
  row, and report the switch to the maintainer.
- Range buttons 24h / 7d / 30d (upstream `ButtonGroup`) under the header, shown for
  Battery level and Usage, hidden for Health (its axis is the battery's life).
- The chart: upstream `LevelChart`, `UsageChart`, or `HealthChart`, unchanged in behaviour,
  including hover readouts. The chart's hover readout replaces upstream's `SectionRow`
  detail text; where it is shown is the builder's call.
- Stats block under the chart:
  - Battery level and Usage: upstream's range stats (On battery, Used, Avg drain, Full
    charge lasts, Sleep drain, Last charged).
  - Health: maximum capacity line ("x of y Wh design, z lost") and upstream's six health
    stats (Cycle count, Battery age, Loss per 100 cycles, Loss per year, Measured trend,
    Reaches 80%).
- Empty state: upstream's "No readings in this range yet" text, unchanged in meaning.
- The selected graph and range persist across panel opens and shell restarts, stored in the
  plugin's state directory (for example `${XDG_STATE_HOME}/battery-insights/ui.json`), not in
  `shell.json`. A missing or malformed file falls back to Battery level / 24h.

### Data

Upstream's logger is kept as is: `Service.qml` runs `bin/battery-insights sample` once a
minute and on every plug/unplug, backfills from UPower's in-memory history on the first run
of each shell session, and writes `samples.csv` (31 days) and `health.csv` (forever) under
`${XDG_STATE_HOME:-~/.local/state}/battery-insights/`. Samples are parsed only while the
panel is open, as upstream does. The backfill reaches only as far back as UPower's own
history (about one to two weeks), so 24h and 7d are filled on install and 30d fills in as
the logger runs; the README says so. The stock panel's own data sources stay as they are
(`omarchy-battery-status --shell`, `omarchy-powerprofiles-list --active-state`,
`omarchy-system-stats`, `omarchy-powerprofiles-set`), refreshed every 5 s while open. The
stock panel runs `omarchy-system-stats` but never displays it; it is copied verbatim anyway
to keep the diff against stock minimal (design author's call).

### Keyboard and mouse

- Stock panel keys unchanged: arrows/hjkl move the power-profile cursor, Enter activates,
  Esc closes, Tab switches panels, hover moves the cursor.
- No other keys. Upstream's panel keys are removed: `1` `2` `3` (range), `r` (refresh),
  left/right (range), j/k (scroll). No graph-cycling key is added. Graph and range are
  chosen with the mouse.
- Bar button: left-click toggles the panel. Right-click (stock: toggle the percentage
  label) and middle-click (upstream: refresh) do nothing.
- While the dropdown popup is open, stock keys must not misbehave (see the dropdown spike).

### Copy of the stock panel, and drift

- The stock `Panel.qml` and `Model.js` from `/usr/share/omarchy/shell/plugins/panels/power/`
  are the base of the widget. The stock `Model.js` is vendored verbatim under a distinct
  name (upstream already has a `Model.js`). Every edit to copied stock code is marked with a
  `LOCAL CHANGE` comment so a re-sync is a re-copy plus re-applying marked hunks.
- The repo records the SHA-256 of both stock files as copied and the Omarchy version they
  came from. A drift check script, separate from the `node --test` unit suite so that suite
  stays green on any machine, skips when the stock files are absent and exits non-zero when
  they are present and different; the repo's test runner calls it and prints its result
  prominently (design author's call).
- At runtime the service compares once per shell start and sends one notification per new
  stock hash
  ("Omarchy's battery panel changed; this plugin may need a re-sync"), remembering the
  acknowledged hash in the state directory so it does not repeat.

### Strings

Stock strings keep coming from Omarchy's catalog (`Commons.I18n.t("power.*")`), exactly as
the copied panel uses them. New strings (HISTORY, dropdown labels, stats labels, empty
state, drift notice) go through the plugin's own `i18n/en.json` via `Commons.Translations`.
Upstream's hard-coded English strings move into that catalog as they are touched.

### Licensing

- The fork is GPL-3.0-or-later: `LICENSE` holds the GPLv3 text (from GitHub's license API).
  Upstream's MIT notice is kept in `LICENSE.MIT`, headed by a note that it covers the code
  taken through `8d27d29`.
- The stock panel files copied from Omarchy are MIT, `Copyright (c) David Heinemeier
  Hansson` (basecamp/omarchy `LICENSE`; the installed package ships no license file). Their
  notice is kept in the repo alongside upstream's, and each copied file names its source
  path and the Omarchy version it was copied from.

### Testing

- Keep upstream's `node --test test/` suite green.
- New pure logic (ui-state parsing and fallback, drift-hash comparison) gets
  unit tests that fail on a deliberately broken copy.
- The drift check script (see "Copy of the stock panel, and drift").
- Manual live check list in the README or `docs/`: bar icon and percentage label,
  right-click and middle-click do nothing, `SUPER+CTRL+P`, the menu's "Show Battery %"
  toggles the label, profile switching by mouse and keyboard, Esc and Tab, each graph and
  range by mouse, upstream's panel keys do nothing, persistence across a shell restart,
  removal restores `omarchy.power`.
- Bug hunt once implemented (maintainer requirement: this must ship without known bugs).
  Independent reviewers read the finished diff against this design and the stock panel,
  looking for logic errors, edge cases (no battery, AC plug/unplug mid-open, empty or
  corrupt logs, a missing UPower history, clock changes, a desktop with no battery), and any
  stock behaviour that was lost. Each finding is reproduced or demonstrated before it is
  fixed; a finding that cannot be shown is reported as unconfirmed, not silently fixed.
  Every fix gets a regression test where the logic is testable. "Done" means the hunt's
  confirmed findings are all fixed and the suite is green.

### Known limitation

The Omarchy menu's "Show / Hide Battery %" entries decide which label to show with
`omarchy-bar get omarchy.power showPercentage`, which reads the bar entry by its literal id
and does not follow `clonedFrom` (`/usr/bin/omarchy-bar`, `cmd_get`). With this plugin in
the bar the menu always offers "Show Battery %"; choosing it still toggles correctly through
IPC. A fix belongs outside this repo (a local menu override in the user's config, or an
Omarchy change) and is not part of this work.

## Left to the builder

- File layout and component split inside the repo.
- Exact panel width, chart heights, spacing, and where the hover readout sits.
- Whether HealthChart's stats render as one grid or two.

## Last step: README

After the bug hunt, rewrite `README.md` to describe what the fork actually does (maintainer
requirement): that it replaces `omarchy.power`, the panel's sections, the three graphs and
their stats, mouse and key behaviour (including what was removed from upstream and stock),
IPC verbs, install and removal (including how `omarchy.power` comes
back), the logger and where its files live, the known menu limitation, a License section
(GPL-3.0-or-later; upstream and Omarchy MIT notices kept), and credit to upstream Battery
Insights and Omarchy. Every claim in it is checked against the finished code.

## Reference

- Upstream plugin: https://github.com/aabulkhairov/omarchy-battery-insights (MIT)
- Stock panel: `/usr/share/omarchy/shell/plugins/panels/power/{Panel.qml,Model.js,manifest.json}`
- Kit: `/usr/share/omarchy/shell/Ui/{Dropdown,ButtonGroup,KeyboardPanel,PanelKeyCatcher}.qml`
- Clone routing: `/usr/share/omarchy/shell/services/PluginRegistry.qml:171`,
  `/usr/share/omarchy/bin/omarchy-plugin-clone`
