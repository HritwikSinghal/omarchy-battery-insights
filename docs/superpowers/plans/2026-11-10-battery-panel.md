# Battery Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this fork a drop-in replacement for Omarchy's `omarchy.power` bar widget: the
stock battery panel, unchanged, plus a HISTORY section showing one of three graphs.

**Architecture:** `Widget.qml` is a copy of the stock `Panel.qml` with small hunks marked
`LOCAL CHANGE`; the stock `Model.js` is vendored verbatim as `PowerModel.js`. The history UI
moves out of upstream's `Widget.qml` into `HistorySection.qml`, fed by upstream's unchanged
logger, `Model.js` and charts. Pure logic lives in `.pragma library` JS files tested with
`node --test`; QML is checked by `qmllint` (syntax only) and an isolated nested-desktop e2e
run adapted from the maintainer's notification-center fork.

**Tech Stack:** Quickshell/QML (Omarchy 4 shell, `qs.Commons`, `qs.Ui`), bash helper,
Node 20+ `node:test` (built-ins only), Python 3 + `wtype` + `grim` for e2e.

**Spec:** `docs/superpowers/specs/2026-11-10-battery-panel-design.md`. Read it first; this
plan argues from it.

## Global Constraints

- Plugin id `hritwiksinghal.battery-insights`; manifest `omarchy.clonedFrom` = `omarchy.power`.
- The widget's IPC target is `omarchy.power` (a `ShellIpc`); no other IPC target.
- State directory stays `${XDG_STATE_HOME:-$HOME/.local/state}/battery-insights`.
- Every `Text` sets `textFormat: Text.PlainText`. No network access, no sudo.
- Motion: `Style.duration(ms)`, ease-out only.
- Never edit `/usr/share/omarchy/`. Never hand-edit `shell.json` or use `omarchy bar` to swap
  widgets; install/remove only with `omarchy plugin add|disable|remove`.
- New source is ASCII; glyphs/typography in new code are `\uXXXX` escapes. `PowerModel.js`
  is byte-identical to the stock `Model.js`; upstream files keep their bytes unless a task
  edits them.
- No plugin-specific keys. Stock panel keys (Esc, Tab, arrows/hjkl + Enter on profiles) stay.
  Bar button: left-click toggles; right- and middle-click do nothing.
- Graph/range choice persists in `<state dir>/ui.json`, never in `shell.json`.
- New strings come from `i18n/en.json` via `Commons.Translations`; stock strings keep using
  `Commons.I18n.t("power.*")`.
- Public repo: no usernames, hardware models or absolute home paths in code, docs, `claude/`.
- Git: our history starts after `BASE=8d27d29`; never rewrite at or below it. Commit locally
  per task; never push without the maintainer's explicit go.
- Stock files copied from Omarchy `4.0.0.r7637.g29f3bb6`:
  `Panel.qml` sha256 `145cd9632d8caa3a9b390b27cb6e7382b2ccb83610ae4bda04a2755c52a75068`,
  `Model.js` sha256 `0a7f42b18dcdea6da54e02813f0fe9ff57e355f16e7a9caba1ba63913420ca43`.

## Review Focus

1. Two monitors, two widget copies (`ShellIpc` docs: every bar builds its own copy): a
   graph/range pick in one shows in the other, and the shared `ui.json` is not rewritten in
   a loop. -> Task 6 e2e step with a second headless output.
2. After using the dropdown with the mouse, Esc / Tab / arrows still reach the panel
   (`Ui/Dropdown.qml:146` calls `trigger.forceActiveFocus()`), Esc with the popup open
   leaves nothing orphaned, and closing the panel closes the popup. -> Task 7 live checks.
3. First run with no state dir, no `ui.json`, and a `samples.csv` with junk lines: the panel
   opens on Battery level / 24h with the empty-state text where due, and the shell log has no
   QML errors from this plugin. -> Task 6 e2e scenario.
4. AC plug/unplug while the panel is open: stock stats do not collapse, the level chart gets
   a reading at the switch (logger samples on `UPower.onBatteryChanged`), charging colour
   switches. -> Task 7 live checks.
5. Omarchy updates the stock panel: one notification per new stock hash, none on later
   restarts, and `test/run.sh` reports drift loudly. -> Task 3 tests + Task 5 e2e step.

---

### Task 1: Identity, provenance, licences, tracker

**Files:**
- Modify: `manifest.json`, `LICENSE.MIT`
- Create: `PowerModel.js` (byte copy of stock `Model.js`), `stock/omarchy-power.sha256`,
  `stock/SOURCE`, `test/run.sh`, `claude/todo.md`, `claude/progress.md`

**Interfaces:**
- Produces: `stock/omarchy-power.sha256` in `sha256sum` format, two lines, file names
  `Panel.qml` and `Model.js` (stock names); `test/run.sh` (exit non-zero on any failure).

- [ ] **Step 1:** `manifest.json`: id `hritwiksinghal.battery-insights`, version `1.0.0`,
  description "Omarchy's battery panel with battery level, usage and health history",
  `omarchy: { clonedFrom: "omarchy.power" }`, kinds unchanged, `barWidget.defaultSection`
  `right`, schema: replace `showRate` with `showPercentage` (boolean, default false,
  label "Show percentage").
- [ ] **Step 2:** `cp /usr/share/omarchy/shell/plugins/panels/power/Model.js PowerModel.js`;
  write `stock/omarchy-power.sha256` with the two hashes from Global Constraints and
  `stock/SOURCE` (one line per file: stock path, Omarchy version, date copied).
- [ ] **Step 3:** Append Omarchy's MIT notice to `LICENSE.MIT` under a heading saying it
  covers `PowerModel.js` and the code in `Widget.qml` copied from Omarchy's `Panel.qml`
  (text: basecamp/omarchy `LICENSE`, `Copyright (c) David Heinemeier Hansson`).
- [ ] **Step 4:** `test/run.sh`: runs `node --test test/`; Task 3 adds the drift line.
- [ ] **Step 5:** `claude/todo.md` (Notes & Conventions: public repo rule, dev->install
  workflow from Task 7, BASE) and `claude/progress.md` (state + pointer to this plan).
- [ ] **Step 6: Verify**
  Run: `cmp PowerModel.js /usr/share/omarchy/shell/plugins/panels/power/Model.js && (cd /usr/share/omarchy/shell/plugins/panels/power && sha256sum -c "$OLDPWD/stock/omarchy-power.sha256") && omarchy plugin validate . && test/run.sh`
  Expected: no `cmp` output, both `OK`, validation passes, upstream's 10 tests pass.
- [ ] **Step 7: Commit** (`LICENSE` / `LICENSE.MIT` relicense is already staged)
  `git add manifest.json LICENSE.MIT PowerModel.js stock test/run.sh claude docs && git commit -m "Fork identity, stock provenance, GPL-3.0 relicense"`

### Task 2: UI state model

**Files:**
- Create: `UiState.js` (`.pragma library`), `test/ui-state.test.mjs`

**Interfaces:**
- Produces: `GRAPHS = ["level","usage","health"]`, `RANGES = ["24h","7d","30d"]`,
  `isGraph(v): bool`, `isRange(v): bool`, `parse(text): {graph, range}` (never throws),
  `serialize(state): string` (normalised JSON + `"\n"`).

- [ ] **Step 1: Write the failing tests** (load like upstream's test: strip `.pragma`, `vm`;
  compare results through `JSON.parse(JSON.stringify(x))`, objects cross contexts):
  - `parse("")`, `parse("not json")`, `parse("null")`, `parse("[]")`, `parse('{"graph":5}')`
    -> `{graph:"level", range:"24h"}`
  - `parse('{"graph":"usage","range":"7d"}')` -> usage / 7d
  - `parse('{"graph":"bogus","range":"7d"}')` -> level / 7d (fields default independently)
  - `parse('{"graph":"health"}')` -> health / 24h
  - `parse('{"graph":"__proto__","range":"constructor"}')` -> level / 24h
  - `serialize({graph:"bogus"})` === `'{"graph":"level","range":"24h"}\n'`
  - round trip: `serialize(parse(serialize(s)))` === `serialize(s)` for all 9 valid pairs
  - `isGraph("Level")` false, `isGraph("level")` true, `isRange("30d")` true, `isRange("1h")` false
- [ ] **Step 2:** `node --test test/ui-state.test.mjs` -> FAIL (file missing).
- [ ] **Step 3:** Implement `UiState.js`; membership via `indexOf` on the arrays, not object keys.
- [ ] **Step 4:** `test/run.sh` -> all pass. Mutation check: break one fallback, see a fail, restore.
- [ ] **Step 5: Commit** `git commit -m "UiState: parse and serialise the graph/range choice"`

### Task 3: Stock drift check

**Files:**
- Modify: `bin/battery-insights` (new subcommand), `test/run.sh`
- Create: `test/stock-check.test.mjs`

**Interfaces:**
- Consumes: `stock/omarchy-power.sha256` (Task 1).
- Produces: `battery-insights stock-check [--notify-once]`. Env overrides (tests only):
  `BATTERY_INSIGHTS_STOCK_DIR` (default `${OMARCHY_PATH:-/usr/share/omarchy}/shell/plugins/panels/power`),
  `BATTERY_INSIGHTS_STOCK_SUMS` (default `<script dir>/../stock/omarchy-power.sha256`).
  Output `key=value` lines; exit `0` same (`status=same`), `3` changed (`status=changed`,
  `changed=<comma list of stock names>`), `4` absent (`status=absent`, either file missing).
  With `--notify-once` and status changed: fingerprint = sha256 of the two current hashes;
  if it differs from `$STATE_DIR/stock-ack`, print `notify=1` and write the fingerprint
  there (creating `$STATE_DIR`), else `notify=0`. Exit code unchanged by the flag.

- [ ] **Step 1: Write the failing tests** (`spawnSync("bash", [helper, "stock-check", ...])`,
  temp dirs from `fs.mkdtempSync`, env `XDG_STATE_HOME` pointed at a temp dir):
  - matching copies -> exit 0, stdout has `status=same`
  - `Model.js` edited -> exit 3, `status=changed`, `changed=Model.js`
  - both edited -> `changed=Panel.qml,Model.js`
  - `Panel.qml` missing -> exit 4, `status=absent`
  - `--notify-once`: first run `notify=1`, second `notify=0`, after another edit `notify=1`;
    state dir did not exist before the first run and exists after
  - `--notify-once` with status same -> no `notify=` line, `stock-ack` not created
- [ ] **Step 2:** run -> FAIL (unknown subcommand).
- [ ] **Step 3:** Implement `cmd_stock_check` in `bin/battery-insights`; keep `set -o pipefail`
  and `LC_ALL=C`; add to the usage line.
- [ ] **Step 4:** `test/run.sh` gains: run `bin/battery-insights stock-check`; on exit 3 print
  `STOCK DRIFT: <changed> -- re-sync Widget.qml/PowerModel.js` and fail; on exit 4 print
  `stock-check skipped: Omarchy not installed` and do not fail. Run it -> all pass, `status=same`.
- [ ] **Step 5: Commit** `git commit -m "stock-check: detect changes to Omarchy's power panel"`

### Task 4: Widget from the stock panel

**Files:**
- Replace: `Widget.qml` with a copy of stock `Panel.qml`, then apply the hunks below, each
  wrapped in `// LOCAL CHANGE: <why>` ... `// END LOCAL CHANGE`
- Modify: `Service.qml`
- Create: `i18n/en.json`

**Interfaces:**
- Consumes: `UiState` (Task 2), `stock-check --notify-once` (Task 3).
- Produces on the `Widget.qml` root: `property string graph`, `property string range`,
  `function setGraph(value: string)`, `function setRange(value: string)` (ignore invalid
  values, write `ui.json` via `UiState.serialize`), `readonly property string stateDir`,
  `readonly property string helper` (as upstream). IPC on `omarchy.power`: stock verbs plus
  `function range(value: string): void`, `function graph(value: string): void` (both validate,
  set, open), `function state(): string` returning JSON
  `{opened, graph, range, batteryPresent, showPercentage, profiles, activeProfile,
  profileIndex, cursorActive, picker}` (`picker` is `"dropdown"` or `"buttons"`, from Task 6;
  `"none"` until then).

- [ ] **Step 1:** Copy stock `Panel.qml` to `Widget.qml`; hunks: provenance header (path,
  version, sha256); `import "PowerModel.js" as Model` plus `import "UiState.js" as UiState`;
  `BarIconButton.onPressed` toggles only for `Qt.LeftButton`; the IPC verbs above; a root
  `FileView` on `stateDir + "/ui.json"` (`watchChanges: true`, `atomicWrites: true`,
  `onLoaded` -> `UiState.parse`, never writes from `onLoaded`); before the first write make
  sure `stateDir` exists (run `mkdir -p` through `Process`, once). Leave a marked placeholder
  where Task 6 inserts the HISTORY section (after the stats `Row`, before the profile
  `PanelSeparator`).
- [ ] **Step 2:** `Service.qml`: on start run `bash helper stock-check --notify-once`; on
  `notify=1` call `Util.execArgv(["omarchy-notification-send", strings.t("drift.title"), strings.t("drift.body")])`,
  where `strings` is a `Commons.Translations { directory: Qt.resolvedUrl("i18n") }` in the service.
  `i18n/en.json` gets `drift.title` "Battery panel: Omarchy changed its power panel" and
  `drift.body` "Battery Insights copies that panel; it may need a re-sync."
- [ ] **Step 3: Verify**
  Run: `diff /usr/share/omarchy/shell/plugins/panels/power/Panel.qml Widget.qml` and
  `qmllint -I /usr/share/omarchy/shell Widget.qml Service.qml`
  Expected: every diff hunk sits inside a `LOCAL CHANGE` marker; `qmllint` exits 0.
- [ ] **Step 4: Commit** `git commit -m "Widget: stock power panel with ui state and IPC verbs"`

### Task 5: Isolated e2e harness

**Files:**
- Create: `tests/e2e/bie` (adapt `tests/e2e/nce` from the notification-center fork, GPL,
  same maintainer), `tests/e2e/hyprland.lua`, `tests/e2e/fixtures/shell.json`,
  `tests/e2e/smoke.py`, `docs/TESTING.md`

**Interfaces:**
- Produces: `tests/e2e/bie up|down|run <cmd>|wait|shot FILE` (as `nce`); the fake HOME links
  this working tree as `~/.config/omarchy/plugins/hritwiksinghal.battery-insights` and seeds
  `~/.local/state/battery-insights/`. `smoke.py [OUT]` exits non-zero on any failed check.

- [ ] **Step 1:** Fixture `shell.json`: the bar state `omarchy plugin add --enable` leaves
  (read `PluginRegistry.setEnabled`, `services/PluginRegistry.qml:545-591`): this plugin's
  entry where `omarchy.power` was, `showPercentage: true`, `omarchy.power` in
  `disabledPlugins`, the clone-restore record; lock and idle off.
- [ ] **Step 2:** `smoke.py` checks, polling `bie run omarchy-shell omarchy.power state`:
  `shell toggle omarchy.power` opens it (`opened`), `batteryPresent` true, `profiles`
  non-empty; Esc closes; keys `1` `2` `3` `r` leave `range`/`graph` unchanged; Right moves
  `profileIndex` (never press Enter: it would change the real power profile, UPower and
  power-profiles-daemon are on the shared system bus); `graph usage` / `range 7d` via IPC
  persist across a nested shell restart. Screenshot `01-open.png`.
- [ ] **Step 3:** Drift notice: start a session with `BATTERY_INSIGHTS_STOCK_DIR` pointing
  at an edited copy; expect exactly one drift notification in the nested history, and none
  after a nested shell restart.
- [ ] **Step 4:** `docs/TESTING.md`: how to run, requirements, screenshot checklist.
- [ ] **Step 5:** Run `tests/e2e/smoke.py "$TMPDIR/bie-out"` -> all `ok`. Commit
  `git commit -m "e2e: isolated nested desktop smoke test"`

### Task 6: HISTORY section

**Files:**
- Create: `HistorySection.qml`
- Modify: `Widget.qml` (replace the Task 4 placeholder), `i18n/en.json`, `tests/e2e/smoke.py`

**Interfaces:**
- Consumes: root `graph`, `range`, `setGraph`, `setRange`, `stateDir`, `helper` (Task 4);
  `Model`, `LevelChart`, `UsageChart`, `HealthChart` (upstream, unchanged).
- Produces: `HistorySection { active; graph; range; stateDir; helper; foreground; fontFamily }`
  with signals `graphPicked(string value)`, `rangePicked(string value)`, `pickerClosed()`,
  and `readonly property string picker` (`"dropdown"` or `"buttons"`).

- [ ] **Step 1:** Move upstream's history UI from the old `Widget.qml` (git show `8d27d29:Widget.qml`,
  lines 19-31, 64-88, 124-174, 278-497, components 503-597) into `HistorySection.qml`:
  FileViews and `infoProc` bound to `active`; `chargeColor` from the theme; the minute Timer.
  Header row: `PanelSectionHeader` HISTORY + kit `Dropdown` (options from `UiState.GRAPHS`,
  labels from `i18n`); range `ButtonGroup` (`focusable: false`) hidden for health; one chart
  visible per graph; the chart's hover readout on a caption line under the chart; the stats
  grids per the spec; upstream's empty-state text. All upstream literals used here move to
  `i18n/en.json` (`history.*`, `stats.*`, `health.*` keys); `Model.js` formatters stay.
- [ ] **Step 2:** Wire into `Widget.qml`: `active: root.opened`; `onGraphPicked: root.setGraph(value)`;
  `onRangePicked: root.setRange(value)`; `onPickerClosed: keyCatcher.forceActiveFocus()`;
  `state().picker` reads the HistorySection instance's `picker` (`"none"` while it is not
  loaded). Close the dropdown when the panel closes.
- [ ] **Step 3:** Extend `smoke.py`: per graph and range set by IPC, screenshot
  `02-level-24h.png`, `03-level-7d.png`, `04-usage-24h.png`, `05-health.png`; seed
  `samples.csv` from timestamps relative to now (24 h of minute rows with a charge and a
  sleep gap) plus three junk lines; a second headless output in the nested Hyprland
  (`hyprctl output create headless`): after `graph health`, `ui.json` holds `health` and its
  mtime is unchanged 3 s later; first-run scenario with no state dir. Fail on any
  `TypeError|ReferenceError|Cannot read` line naming this plugin's files in the shell log.
- [ ] **Step 4:** `qmllint` both files exit 0; `test/run.sh` and `smoke.py` pass; check the
  screenshots against `docs/TESTING.md`. Commit `git commit -m "HISTORY section: three graphs behind a dropdown"`

### Task 7: Live install and mouse checks (CHECKPOINT: ask the maintainer first)

Installing changes the live bar; restarting the shell is a service restart. Get an explicit
go for both.

- [ ] **Step 1:** `omarchy plugin add "file://$HOME/Projects/omarchy-battery-insights" --enable --yes`;
  then `git -C ~/.config/omarchy/plugins/hritwiksinghal.battery-insights remote set-url origin https://github.com/HritwikSinghal/omarchy-battery-insights.git`.
  Confirm the bar entry swapped in place with `showPercentage` kept and `omarchy.power`
  disabled. Later loads: `git -C <installed> fetch ~/Projects/omarchy-battery-insights main && git -C <installed> merge --ff-only FETCH_HEAD`,
  then `omarchy-shell shell reloadPlugins` (shell restart only with the maintainer's go).
- [ ] **Step 2:** Maintainer-assisted checklist (record each result in `claude/progress.md`):
  dropdown opens, selects, closes on outside click and on Esc; after using it, Esc / Tab /
  arrows still work; panel close closes the popup; range buttons; chart hover readouts;
  right- and middle-click do nothing; `SUPER+CTRL+P`; menu "Show Battery %" flips the label;
  profiles by mouse and by arrows + Enter; AC plug/unplug while open (Review Focus 4);
  choice survives a shell restart.
- [ ] **Step 3:** Dropdown verdict: if any dropdown check fails and cannot be fixed in
  `HistorySection.qml`, switch the header to a second `ButtonGroup` (Level / Usage /
  Health), set `picker` to `"buttons"`, re-run Steps 2 and Task 6 Step 4, and tell the
  maintainer.
- [ ] **Step 4:** `omarchy plugin disable hritwiksinghal.battery-insights` restores
  `omarchy.power` in the same slot; `omarchy plugin enable` swaps back. Commit any fixes.

### Task 8: Bug hunt

- [ ] **Step 1:** Three `bug-finder` agents on model `opus` (maintainer's choice), each given the spec and a
  different slice of `git diff 8d27d29..HEAD`: (a) `Widget.qml` vs stock `Panel.qml`, IPC,
  clicks, keys; (b) `HistorySection.qml`, `UiState.js`, chart data edge cases from the spec's
  Testing list; (c) `bin/battery-insights`, `Service.qml`, drift, install/remove path.
- [ ] **Step 2:** For each finding: reproduce (unit test, e2e step, or live check) before
  fixing; unreproducible ones are listed as unconfirmed. Fix confirmed ones with a
  regression test where testable.
- [ ] **Step 3:** `test/run.sh`, `smoke.py`, and the Task 7 checklist items touched by fixes
  all pass. Commit per fix.

### Task 9: README, trackers, history

- [ ] **Step 1:** Rewrite `README.md` per the spec's "Last step: README"; check every claim
  against the code (keys, verbs, files, install/remove, 30d fill note, menu limitation,
  License section, credits).
- [ ] **Step 2:** Update `claude/progress.md`; add a one-line pointer to this fork in the
  maintainer's hypr config tracker (`~/.config/hypr/claude/todo.md`, outside this repo).
- [ ] **Step 3:** Propose (do not run) a squash of `8d27d29..HEAD` into a few meaningful
  commits and a push to `origin`; wait for the maintainer's yes.
