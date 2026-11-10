#!/usr/bin/env python3
"""End-to-end smoke test on a hidden desktop (tests/e2e/bie).

Starts isolated sessions with this working tree as the battery plugin, drives
the panel with real key presses (wtype) and IPC, and checks the plugin's own
state (omarchy-shell omarchy.power state) after each step. Screenshots go to
the output directory; docs/TESTING.md says what each should show.

    tests/e2e/smoke.py [OUTPUT_DIR]

Exits 0 when every check passes, 1 otherwise. Never touches the real desktop.
Never presses Enter on a power profile: power-profiles-daemon is on the shared
system bus, so that would change the real machine's profile.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
BIE = os.path.join(HERE, "bie")
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="bie-smoke.")
os.makedirs(OUT, exist_ok=True)
DRIFT_TITLE = "Omarchy changed its power panel"
PLUGIN_FILES = ("battery-insights/Widget.qml", "battery-insights/Service.qml", "battery-insights/HistorySection.qml",
                "battery-insights/LevelChart.qml", "battery-insights/UsageChart.qml", "battery-insights/HealthChart.qml")

failures = []


def bie(*args, check=True, env=None):
    return subprocess.run([BIE, *args], check=check, capture_output=True, text=True, env=env).stdout


def state():
    return json.loads(bie("state"))


def ipc(*args):
    bie("run", "omarchy-shell", "omarchy.power", *args)


def key(*args):
    """One wtype call, e.g. key("-k", "Right") or key("1")."""
    bie("run", "wtype", *args)


def check(what, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {what}" + ("" if ok else f"\n      {detail}"))
    if not ok:
        failures.append(what)


def until(what, predicate, timeout=8.0, probe=state):
    """Polls probe() until predicate holds; records a failure otherwise."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = probe()
            if predicate(last):
                print(f"ok    {what}")
                return last
        except (subprocess.CalledProcessError, ValueError, KeyError, TypeError, OSError):
            pass  # no answer yet, or a field missing: keep polling, then fail
        time.sleep(0.15)
    failures.append(what)
    print(f"FAIL  {what}\n      last: {json.dumps(last)[:600]}")
    return last


def shot(name):
    path = os.path.join(OUT, name)
    # The nested Hyprland warns that it was not started by start-hyprland; the
    # banner would cover the top of the panel.
    bie("run", "hyprctl", "dismissnotify", check=False)
    time.sleep(0.5)  # let the panel's open animation settle
    bie("shot", path)
    print(f"shot  {path}")


def home():
    return bie("home").strip()


def read(path):
    with open(path) as f:
        return f.read()


def drift_notifications():
    """How many distinct drift notifications the nested daemon has seen."""
    base = os.path.join(home(), ".local/state/omarchy/notifications")
    seen = set()
    for name in ("live.json", "history.json"):
        try:
            entries = json.loads(read(os.path.join(base, name)))
        except (OSError, ValueError):
            continue
        for entry in entries if isinstance(entries, list) else []:
            blob = json.dumps(entry, sort_keys=True)
            if DRIFT_TITLE in blob:
                seen.add(str(entry.get("id", blob)) if isinstance(entry, dict) else blob)
    return len(seen)


def plugin_errors():
    """QML errors the shell logged from this plugin's files."""
    log = os.path.join(os.path.dirname(home()), "shell.log")
    bad = ("TypeError", "ReferenceError", "Cannot read", "is not defined", "is not a function", "Unable to assign")
    try:
        lines = read(log).splitlines()
    except OSError:
        return ["shell.log missing"]
    return [line for line in lines if any(f in line for f in PLUGIN_FILES) and any(b in line for b in bad)]


class Session:
    """One isolated desktop; `with Session(name, seed=..., env=...)`."""

    def __init__(self, name, seed=None, env=None):
        self.name, self.seed, self.extra = name, seed, env or {}

    def __enter__(self):
        current = os.path.join(os.environ.get("TMPDIR") or "/tmp", "bie-current")
        if os.path.exists(os.path.join(current, "ready")):
            raise SystemExit(f"smoke: a session is already up ({os.path.realpath(current)}); run `tests/e2e/bie down` first")
        env = dict(os.environ, **self.extra)
        if self.seed:
            env["BIE_SEED"] = self.seed
        log = open(os.path.join(OUT, f"bie-{self.name}.log"), "w")
        self.up = subprocess.Popen([BIE, "up"], stdout=log, stderr=subprocess.STDOUT, env=env)
        try:
            bie("wait", "60")
            if self.up.poll() is not None:
                raise SystemExit(f"smoke: bie up exited early; see bie-{self.name}.log")
        except (subprocess.CalledProcessError, SystemExit) as error:
            # __exit__ does not run for a session that failed to start, so stop
            # it here rather than leave a hidden desktop running.
            bie("down", check=False)
            try:
                self.up.wait(timeout=45)
            except subprocess.TimeoutExpired:
                self.up.terminate()
            if isinstance(error, SystemExit):
                raise
            raise SystemExit(f"smoke: session {self.name} never got ready; see bie-{self.name}.log") from error
        print(f"\n== session: {self.name}")
        return self

    def __exit__(self, *exc):
        errors = plugin_errors()
        check(f"[{self.name}] no QML errors from the plugin in shell.log", not errors, "\n      ".join(errors[:5]))
        shutil.copy(os.path.join(os.path.dirname(home()), "shell.log"), os.path.join(OUT, f"shell-{self.name}.log"))
        bie("down", check=False)
        try:
            self.up.wait(timeout=15)
        except subprocess.TimeoutExpired:
            print("warn  session did not stop within 15 s", file=sys.stderr)
        return False


def seed_dir(name, files):
    path = os.path.join(OUT, f"seed-{name}")
    os.makedirs(path, exist_ok=True)
    for fname, text in files.items():
        with open(os.path.join(path, fname), "w") as f:
            f.write(text)
    return path


def scenario_panel():
    with Session("panel"):
        s = until("the widget answers with a battery present", lambda s: s["batteryPresent"] is True)
        check("it starts on battery level / 24h", s and s["graph"] == "level" and s["range"] == "24h", json.dumps(s))
        check("showPercentage carried over from the fixture", s and s["showPercentage"] is True, json.dumps(s))

        bie("run", "omarchy-shell", "shell", "toggle", "omarchy.power")
        s = until("SUPER+CTRL+P's call (shell toggle omarchy.power) opens it with key focus",
                  lambda s: s["opened"] and s["keyFocus"])
        until("the stock panel lists power profiles", lambda s: len(s["profiles"]) > 0)
        shot("01-open.png")

        for k in ("1", "2", "3", "r"):
            key(k)
        time.sleep(0.6)
        s = state()
        check("upstream's keys 1 2 3 r do nothing", s["opened"] and s["graph"] == "level" and s["range"] == "24h", json.dumps(s))

        # The stock cursor clamps at the ends of the row, so move away from
        # whichever end the active profile sits at.
        start = s["profileIndex"]
        step = "Left" if start == len(s["profiles"]) - 1 else "Right"
        key("-k", step)
        until(f"first {step} shows the profile cursor (stock)", lambda s: s["cursorActive"] is True)
        if len(s["profiles"]) > 1:
            key("-k", step)
            until(f"second {step} moves the profile cursor (stock)", lambda s: s["profileIndex"] != start)

        key("-k", "Escape")
        until("Esc closes the panel (stock)", lambda s: not s["opened"])

        ipc("graph", "usage")
        until("IPC graph usage opens the panel on usage", lambda s: s["opened"] and s["graph"] == "usage")
        ipc("range", "7d")
        until("IPC range 7d picks 7 days", lambda s: s["range"] == "7d")
        ipc("graph", "bogus")
        time.sleep(0.4)
        check("IPC graph with an unknown value is ignored", state()["graph"] == "usage")
        ui = os.path.join(home(), ".local/state/battery-insights/ui.json")
        until("the choice is written to ui.json, not shell.json",
              lambda text: text == '{"graph":"usage","range":"7d"}\n', probe=lambda: read(ui))
        shell_json = read(os.path.join(home(), ".config/omarchy/shell.json"))
        check("shell.json holds no graph/range", '"graph"' not in shell_json and '"range"' not in shell_json)


def history_seed():
    """24 h of minute readings ending now: discharge, a 6 h sleep gap, a 1 h
    charge, discharge again; plus three junk lines the parser must skip, and
    20 days of daily health rows so the measured trend has data."""
    now = int(time.time())
    full = 69.0
    rows = []
    for t in range(now - 24 * 3600, now - 120, 60):
        age_h = (now - t) / 3600
        if 14 > age_h > 8:
            continue  # asleep: no readings
        if age_h >= 14:
            p, s, w = 95 - (24 - age_h) * 5, "D", 8.0
        elif age_h > 7:
            p, s, w = 42 + (8 - age_h) * 48, "C", 30.0
        else:
            p, s, w = 90 - (7 - age_h) * 6, "D", 8.0
        rows.append(f"{t},{p:.2f},{p / 100 * full:.3f},{full:.3f},{w:.2f},{s}\n")
    junk = ["not a reading\n", "1,2\n", "x,y,z,w,v,u\n"]
    samples = "".join(rows[:10] + junk + rows[10:])
    day = 86400
    health = "".join(
        f"{time.strftime('%Y-%m-%d', time.localtime(now - (20 - i) * day))},{69.70 - i * 0.01:.2f},68.60,{80 + i}\n"
        for i in range(20))
    return seed_dir("history", {"samples.csv": samples, "health.csv": health}), len(rows)


def scenario_history():
    seed, seeded = history_seed()
    with Session("history", seed=seed):
        ipc("graph", "level")
        s = until("IPC graph level opens the panel with the HISTORY section loaded",
                  lambda s: s["opened"] and s["historySamples"] >= seeded, timeout=15)
        check("the graph picker is the dropdown", s and s["picker"] == "dropdown", json.dumps(s))
        shot("02-level-24h.png")
        ipc("range", "7d")
        until("range 7d", lambda s: s["range"] == "7d")
        shot("03-level-7d.png")
        ipc("graph", "usage")
        ipc("range", "24h")
        until("usage / 24h", lambda s: s["graph"] == "usage" and s["range"] == "24h")
        shot("04-usage-24h.png")
        ipc("graph", "health")
        until("health", lambda s: s["graph"] == "health")
        shot("05-health.png")

        # A second monitor gets its own bar and its own copy of the widget; a
        # pick on one must not set off a write loop between the two.
        bie("run", "hyprctl", "output", "create", "headless", "E2E-2")
        time.sleep(3)
        ipc("graph", "level")
        ui = os.path.join(home(), ".local/state/battery-insights/ui.json")
        until("with two monitors, a pick lands in ui.json",
              lambda text: text == '{"graph":"level","range":"24h"}\n', probe=lambda: read(ui))
        mtime = os.stat(ui).st_mtime_ns
        time.sleep(3)
        check("and nothing rewrites it afterwards", os.stat(ui).st_mtime_ns == mtime)


def scenario_first_run_two_monitors():
    """No state directory when the two widget copies load: a pick made through
    one copy must still reach the other. The fake `upower` (no battery) makes
    the logger exit before it creates the directory, so only the widget can."""
    fakebin = os.path.join(OUT, "fakebin")
    os.makedirs(fakebin, exist_ok=True)
    with open(os.path.join(fakebin, "upower"), "w") as f:
        f.write("#!/bin/sh\nexit 0\n")
    os.chmod(os.path.join(fakebin, "upower"), 0o755)
    env = {"PATH": fakebin + ":" + os.environ["PATH"], "BIE_OUTPUTS": "2"}
    with Session("first-run-2mon", env=env):
        s = until("the widget answers on one of two screens", lambda s: s["batteryPresent"] is True and s["screen"] != "")
        first = s["screen"]
        ipc("graph", "health")
        until("the pick is made through the first copy", lambda s: s["graph"] == "health")
        ui = os.path.join(home(), ".local/state/battery-insights/ui.json")
        until("and saved", lambda text: '"graph":"health"' in text, probe=lambda: read(ui))
        bie("run", "hyprctl", "output", "remove", first)
        until("the other screen's copy shows the same pick",
              lambda s: s["screen"] not in ("", first) and s["graph"] == "health", timeout=10)


def scenario_short_screen():
    """A screen too short for the whole panel: the card is capped, the content
    scrolls, and moving to the power profiles with the keyboard brings them
    into view (they sit at the bottom)."""
    with Session("short-screen"):
        bie("run", "hyprctl", "eval", 'hl.monitor({ output = "E2E", mode = "1280x480@60", position = "0x0", scale = 1 })')
        time.sleep(1)
        ipc("graph", "level")
        s = until("the panel opens with key focus on a 480 px screen", lambda s: s["opened"] and s["keyFocus"])
        until("its content is taller than the card", lambda s: s["contentHeight"] > s["cardHeight"] + 20)
        shot("06-short-screen.png")
        key("-k", "Right")
        until("the profile cursor brings the power profiles into view", lambda s: s["cursorActive"] and s["scrollY"] > 0)
        shot("07-short-screen-profiles.png")


def scenario_persistence():
    seed = seed_dir("persist", {"ui.json": '{"graph":"health","range":"30d"}\n'})
    with Session("persist", seed=seed):
        until("a saved choice is restored at shell start", lambda s: s["graph"] == "health" and s["range"] == "30d")


def scenario_drift():
    stock = os.path.join(OUT, "stock-edited")
    os.makedirs(stock, exist_ok=True)
    for name in ("Panel.qml", "Model.js"):
        shutil.copy(os.path.join(os.environ.get("OMARCHY_PATH", "/usr/share/omarchy"), "shell/plugins/panels/power", name), stock)
    with open(os.path.join(stock, "Model.js"), "a") as f:
        f.write("// a newer Omarchy\n")
    env = {"BATTERY_INSIGHTS_STOCK_DIR": stock}

    with Session("drift", env=env):
        until("a changed stock panel raises one drift notification", lambda n: n == 1, timeout=20, probe=drift_notifications)
        time.sleep(3)
        check("and only one", drift_notifications() == 1)
        ack_path = os.path.join(home(), ".local/state/battery-insights/stock-ack")
        # Marked announced only after the send succeeded.
        ack = until("the sent notice is marked announced", lambda text: len(text.strip()) == 64,
                    probe=lambda: read(ack_path))

    seed = seed_dir("drift-again", {"stock-ack": ack})
    with Session("drift-again", seed=seed, env=env):
        until("the widget is up", lambda s: s["batteryPresent"] is True)
        time.sleep(6)
        check("a restart on the same stock version stays quiet", drift_notifications() == 0)

    # A send that fails (here a sender that always exits 1) must leave the
    # version unannounced, so the next start tries again.
    failing = os.path.join(OUT, "fakebin-send-fails")
    os.makedirs(failing, exist_ok=True)
    with open(os.path.join(failing, "omarchy-notification-send"), "w") as f:
        f.write("#!/bin/sh\nexit 1\n")
    os.chmod(os.path.join(failing, "omarchy-notification-send"), 0o755)
    with Session("drift-send-fails", env=dict(env, PATH=failing + ":" + os.environ["PATH"])):
        until("the widget is up", lambda s: s["batteryPresent"] is True)
        time.sleep(6)
        ack_path = os.path.join(home(), ".local/state/battery-insights/stock-ack")
        check("a failed send leaves the version unannounced, to retry next start", not os.path.exists(ack_path))


SCENARIOS = {
    "panel": scenario_panel,
    "history": scenario_history,
    "first-run-2mon": scenario_first_run_two_monitors,
    "short-screen": scenario_short_screen,
    "persist": scenario_persistence,
    "drift": scenario_drift,
}


def main():
    # SMOKE_ONLY=history,drift runs a subset; the default runs them all.
    only = [name for name in os.environ.get("SMOKE_ONLY", "").split(",") if name]
    for name, scenario in SCENARIOS.items():
        if not only or name in only:
            scenario()
    print(f"\n{'PASS' if not failures else 'FAIL'}: {len(failures)} failed check(s); output in {OUT}")
    for what in failures:
        print(f"  - {what}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
