// Run with: node --test test/
// `battery-insights sample` appends a reading to samples.csv, prunes it to 31
// days and (with --backfill) merges UPower's history around what is logged.
// These tests run the real helper with fake `upower` and `gdbus` on PATH, so
// they never touch the machine's battery, and a private XDG_STATE_HOME.
import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const helper = fileURLToPath(new URL("../bin/battery-insights", import.meta.url))
const DAY = 86400

const UPOWER = `#!/bin/bash
case "$1" in
  -e) echo /org/freedesktop/UPower/devices/battery_BAT0 ;;
  -i) cat <<'EOF'
  native-path:          BAT0
  power supply:         yes
  state:                discharging
  energy:               40 Wh
  energy-full:          60 Wh
  energy-full-design:   62 Wh
  energy-rate:          8 W
  percentage:           66%
  charge-cycles:        10
EOF
  ;;
esac
`

// UPower's GetHistory reply: one charge and one rate point, an hour ago.
function gdbus(now) {
  const t = now - 3600
  return `#!/bin/bash
case "$*" in
  *GetHistory\\ charge*) echo "([(uint32 ${t}, 70.0, uint32 2)],)" ;;
  *GetHistory\\ rate*) echo "([(uint32 ${t}, 8.0, uint32 2)],)" ;;
esac
`
}

function fixture(t, upower = UPOWER) {
  const root = mkdtempSync(join(tmpdir(), "bi-sample-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bin = join(root, "bin")
  const dir = join(root, "state", "battery-insights")
  mkdirSync(bin, { recursive: true })
  mkdirSync(dir, { recursive: true })
  const now = Math.floor(Date.now() / 1000)
  writeFileSync(join(bin, "upower"), upower)
  writeFileSync(join(bin, "gdbus"), gdbus(now))
  chmodSync(join(bin, "upower"), 0o755)
  chmodSync(join(bin, "gdbus"), 0o755)
  const samples = join(dir, "samples.csv")
  const run = (...args) => spawnSync("bash", [helper, "sample", ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(root, "state") },
  })
  const rows = () => readFileSync(samples, "utf8").split("\n").filter((l) => /^\d+,/.test(l))
  return { now, samples, run, rows }
}

// Minute rows from `fromAgo` seconds ago to `toAgo` seconds ago.
function rows(now, fromAgo, toAgo, step = 3600) {
  const out = []
  for (let t = now - fromAgo; t <= now - toAgo; t += step) out.push(`${t},50.00,30.000,60.000,8.00,D`)
  return out
}

test("backfill keeps logged history when samples.csv starts with a junk line", (t) => {
  const f = fixture(t)
  const logged = rows(f.now, 20 * DAY, 2 * DAY)
  writeFileSync(f.samples, ["x,y,z,w,v,u", ...logged].join("\n") + "\n")
  const r = f.run("--backfill")
  assert.equal(r.status, 0, r.stderr)
  const kept = f.rows()
  for (const row of logged) assert.ok(kept.includes(row), `lost ${row}`)
})

test("prune drops junk lines and readings older than 31 days, keeps the rest", (t) => {
  const f = fixture(t)
  const old = rows(f.now, 40 * DAY, 33 * DAY)
  const recent = rows(f.now, 20 * DAY, 2 * DAY)
  writeFileSync(f.samples, [...old, "x,y,z,w,v,u", ...recent].join("\n") + "\n")
  const r = f.run()
  assert.equal(r.status, 0, r.stderr)
  const text = readFileSync(f.samples, "utf8")
  assert.ok(!text.includes("x,y,z"), "junk line survived the prune")
  const kept = f.rows()
  for (const row of old) assert.ok(!kept.includes(row), `kept a 33+ day old row ${row}`)
  for (const row of recent) assert.ok(kept.includes(row), `lost ${row}`)
})

test("a junk line left by an old prune does not wipe history on the next backfill", (t) => {
  const f = fixture(t)
  const old = rows(f.now, 40 * DAY, 33 * DAY)
  const recent = rows(f.now, 20 * DAY, 2 * DAY)
  writeFileSync(f.samples, [...old, "x,y,z,w,v,u", ...recent].join("\n") + "\n")
  assert.equal(f.run().status, 0)
  assert.equal(f.run("--backfill").status, 0)
  const kept = f.rows()
  for (const row of recent) assert.ok(kept.includes(row), `lost ${row}`)
})

test("a first field that is shell code is never evaluated", (t) => {
  const f = fixture(t)
  const marker = join(tmpdir(), `bi-pwned-${process.pid}-${Date.now()}`)
  t.after(() => rmSync(marker, { force: true }))
  writeFileSync(f.samples, `a[$(touch ${marker})],1,1,1,1,D\n` + rows(f.now, 5 * DAY, 2 * DAY).join("\n") + "\n")
  f.run("--backfill")
  f.run()
  assert.equal(spawnSync("test", ["-e", marker]).status, 1, "a command in samples.csv was executed")
})

// UPower answering without a reading (mid-restart, a device going away) must
// not log a fake 0% row: one such row reads as most of the battery "used" and
// drops the level line to zero.
test("a reading UPower could not give is skipped, not logged as 0%", (t) => {
  const partial = UPOWER.replace(/^ *(energy|percentage):.*\n/gm, "")
  const f = fixture(t, partial)
  const logged = rows(f.now, 3 * DAY, 2 * DAY)
  writeFileSync(f.samples, logged.join("\n") + "\n")
  const r = f.run()
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(f.rows(), logged)
})

test("a normal reading is still logged", (t) => {
  const f = fixture(t)
  const r = f.run()
  assert.equal(r.status, 0, r.stderr)
  const last = f.rows().at(-1).split(",")
  assert.deepEqual(last.slice(1), ["66.00", "40.000", "60.000", "8.00", "D"])
})
