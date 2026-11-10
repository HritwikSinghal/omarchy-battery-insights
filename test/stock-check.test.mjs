// Run with: node --test test/
// `battery-insights stock-check` compares Omarchy's installed power panel
// files against the hashes recorded when they were copied (stock/), so a
// re-sync is never missed. These tests run the real helper against a fixture
// "stock" directory and a private XDG_STATE_HOME.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const helper = fileURLToPath(new URL("../bin/battery-insights", import.meta.url))
const sha256 = (text) => createHash("sha256").update(text).digest("hex")

// A stock dir holding the two files as they were "copied", and a sums file
// recording their hashes in sha256sum format.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bi-stock-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stock = join(root, "stock")
  const sums = join(root, "omarchy-power.sha256")
  const state = join(root, "state")
  spawnSync("mkdir", ["-p", stock])
  writeFileSync(join(stock, "Panel.qml"), "panel v1\n")
  writeFileSync(join(stock, "Model.js"), "model v1\n")
  writeFileSync(sums, `${sha256("panel v1\n")}  Panel.qml\n${sha256("model v1\n")}  Model.js\n`)
  // An "Omarchy install" is a directory with a shell/ in it.
  const omarchy = join(root, "omarchy")
  spawnSync("mkdir", ["-p", join(omarchy, "shell")])
  const helperRun = (...args) => {
    const r = spawnSync("bash", [helper, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        BATTERY_INSIGHTS_OMARCHY_ROOT: f.omarchy,
        BATTERY_INSIGHTS_STOCK_DIR: f.stockDir,
        BATTERY_INSIGHTS_STOCK_SUMS: sums,
        XDG_STATE_HOME: state,
      },
    })
    return { code: r.status, lines: r.stdout.split("\n").filter(Boolean), stderr: r.stderr }
  }
  const run = (...args) => helperRun("stock-check", ...args)
  // What the service does once the notification was sent.
  const acknowledge = (fingerprint) => helperRun("stock-ack", fingerprint)
  const ack = join(state, "battery-insights", "stock-ack")
  const f = { stock, stockDir: stock, omarchy, root, sums, state, ack, run, acknowledge }
  return f
}

// `--notify-once` names the stock version to announce; only the service, once
// the notification really went out, marks it announced (stock-ack).
const fingerprintOf = (lines) => (lines.find((l) => l.startsWith("fingerprint=")) || "").slice("fingerprint=".length)
const withoutFingerprint = (lines) => lines.filter((l) => !l.startsWith("fingerprint="))

test("unchanged stock files report same and exit 0", (t) => {
  const f = fixture(t)
  const r = f.run()
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(r.lines, ["status=same"])
})

test("an edited Model.js reports changed and names it", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.stock, "Model.js"), "model v2\n")
  const r = f.run()
  assert.equal(r.code, 3, r.stderr)
  assert.deepEqual(r.lines, ["status=changed", "changed=Model.js"])
})

test("both files edited are both named, in recorded order", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.stock, "Panel.qml"), "panel v2\n")
  writeFileSync(join(f.stock, "Model.js"), "model v2\n")
  const r = f.run()
  assert.equal(r.code, 3, r.stderr)
  assert.deepEqual(r.lines, ["status=changed", "changed=Panel.qml,Model.js"])
})

test("no Omarchy install at all reports absent and exits 4", (t) => {
  const f = fixture(t)
  f.omarchy = join(f.root, "not-installed")
  f.stockDir = join(f.omarchy, "shell/plugins/panels/power")
  const r = f.run()
  assert.equal(r.code, 4, r.stderr)
  assert.deepEqual(r.lines, ["status=absent"])
})

test("the power panel directory gone from an installed Omarchy counts as changed", (t) => {
  const f = fixture(t)
  f.stockDir = join(f.root, "moved-away")
  const r = f.run()
  assert.equal(r.code, 3, r.stderr)
  assert.deepEqual(r.lines, ["status=changed", "changed=Panel.qml,Model.js"])
})

// Omarchy renaming or dropping one of the files is a change to re-sync, not
// "Omarchy is not installed" (which would be skipped silently).
test("a file gone from an installed Omarchy counts as changed", (t) => {
  const f = fixture(t)
  rmSync(join(f.stock, "Model.js"))
  const r = f.run()
  assert.equal(r.code, 3, r.stderr)
  assert.deepEqual(r.lines, ["status=changed", "changed=Model.js"])
})

test("--notify-once fires for a file that went missing", (t) => {
  const f = fixture(t)
  rmSync(join(f.stock, "Panel.qml"))
  const r = f.run("--notify-once")
  assert.equal(r.code, 3, r.stderr)
  assert.deepEqual(withoutFingerprint(r.lines), ["status=changed", "changed=Panel.qml", "notify=1"])
  assert.match(fingerprintOf(r.lines), /^[0-9a-f]{64}$/)
})

test("a sums file without a trailing newline still checks its last entry", (t) => {
  const f = fixture(t)
  writeFileSync(f.sums, `${sha256("panel v1\n")}  Panel.qml\n${sha256("model v1\n")}  Model.js`)
  writeFileSync(join(f.stock, "Model.js"), "model v2\n")
  const r = f.run()
  assert.equal(r.code, 3, r.stderr)
  assert.deepEqual(r.lines, ["status=changed", "changed=Model.js"])
})

test("a sums file with CRLF line ends still matches", (t) => {
  const f = fixture(t)
  writeFileSync(f.sums, `${sha256("panel v1\n")}  Panel.qml\r\n${sha256("model v1\n")}  Model.js\r\n`)
  const r = f.run()
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(r.lines, ["status=same"])
})

test("an empty or malformed sums file is an error, never 'same'", (t) => {
  const f = fixture(t)
  for (const text of ["", "\n", "not-a-hash  Panel.qml\n"]) {
    writeFileSync(f.sums, text)
    const r = f.run()
    assert.equal(r.code, 1, `sums ${JSON.stringify(text)}: ${r.lines}`)
    assert.deepEqual(r.lines, [])
  }
})

test("--notify-once asks for one notification per new stock version", (t) => {
  const f = fixture(t)
  writeFileSync(join(f.stock, "Model.js"), "model v2\n")
  assert.equal(existsSync(f.state), false)

  const first = f.run("--notify-once")
  assert.equal(first.code, 3, first.stderr)
  assert.deepEqual(withoutFingerprint(first.lines), ["status=changed", "changed=Model.js", "notify=1"])
  const fingerprint = fingerprintOf(first.lines)
  assert.match(fingerprint, /^[0-9a-f]{64}$/)

  // Not sent yet (or the send failed): the next start asks again.
  assert.equal(existsSync(f.ack), false)
  const retry = f.run("--notify-once")
  assert.deepEqual(withoutFingerprint(retry.lines), ["status=changed", "changed=Model.js", "notify=1"])
  assert.equal(fingerprintOf(retry.lines), fingerprint)

  // Sent: acknowledged, and quiet from then on.
  const acked = f.acknowledge(fingerprint)
  assert.equal(acked.code, 0, acked.stderr)
  assert.equal(existsSync(f.ack), true)
  const second = f.run("--notify-once")
  assert.equal(second.code, 3)
  assert.deepEqual(second.lines, ["status=changed", "changed=Model.js", "notify=0"])

  // A newer stock version is announced again.
  writeFileSync(join(f.stock, "Model.js"), "model v3\n")
  const third = f.run("--notify-once")
  assert.deepEqual(withoutFingerprint(third.lines), ["status=changed", "changed=Model.js", "notify=1"])
  assert.notEqual(fingerprintOf(third.lines), fingerprint)
})

test("stock-ack refuses anything but a fingerprint and writes nothing then", (t) => {
  const f = fixture(t)
  for (const bad of ["", "abc", "../../etc/passwd", "G".repeat(64)]) {
    const r = f.acknowledge(bad)
    assert.equal(r.code, 1, `accepted ${JSON.stringify(bad)}`)
  }
  assert.equal(existsSync(f.ack), false)
})

test("--notify-once on unchanged stock says nothing about notifying and writes no ack", (t) => {
  const f = fixture(t)
  const r = f.run("--notify-once")
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(r.lines, ["status=same"])
  assert.equal(existsSync(f.ack), false)
})
