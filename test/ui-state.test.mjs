// Run with: node --test test/
// UiState.js is a QML `.pragma library` script, so it is evaluated in a vm
// context here rather than imported. Objects it returns belong to that
// context, so results are compared as plain JSON.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const source = readFileSync(new URL("../UiState.js", import.meta.url), "utf8").replace(/^\.pragma library\s*$/m, "")
const UiState = vm.createContext({})
vm.runInContext(source, UiState)

const plain = (value) => JSON.parse(JSON.stringify(value))
const DEFAULTS = { graph: "level", range: "24h" }

test("parse falls back to battery level / 24h for missing or malformed state", () => {
  for (const text of ["", "not json", "null", "[]", '{"graph":5}', "{", '"level"', "42"]) {
    assert.deepEqual(plain(UiState.parse(text)), DEFAULTS, `input ${JSON.stringify(text)}`)
  }
  assert.deepEqual(plain(UiState.parse(null)), DEFAULTS, "null input")
  assert.deepEqual(plain(UiState.parse(undefined)), DEFAULTS, "undefined input")
})

test("parse keeps a valid choice", () => {
  assert.deepEqual(plain(UiState.parse('{"graph":"usage","range":"7d"}')), { graph: "usage", range: "7d" })
})

test("parse defaults each field on its own", () => {
  assert.deepEqual(plain(UiState.parse('{"graph":"bogus","range":"7d"}')), { graph: "level", range: "7d" })
  assert.deepEqual(plain(UiState.parse('{"graph":"health"}')), { graph: "health", range: "24h" })
  assert.deepEqual(plain(UiState.parse('{"graph":"usage","range":"1h"}')), { graph: "usage", range: "24h" })
})

test("parse rejects object-prototype names as values", () => {
  assert.deepEqual(plain(UiState.parse('{"graph":"__proto__","range":"constructor"}')), DEFAULTS)
  assert.deepEqual(plain(UiState.parse('{"graph":"toString","range":"hasOwnProperty"}')), DEFAULTS)
})

test("serialize normalises an invalid choice and ends with a newline", () => {
  assert.equal(UiState.serialize({ graph: "bogus" }), '{"graph":"level","range":"24h"}\n')
  assert.equal(UiState.serialize(null), '{"graph":"level","range":"24h"}\n')
})

test("every valid pair serialises to the expected JSON and parses back", () => {
  const table = [
    ["level", "24h", '{"graph":"level","range":"24h"}\n'],
    ["level", "7d", '{"graph":"level","range":"7d"}\n'],
    ["level", "30d", '{"graph":"level","range":"30d"}\n'],
    ["usage", "24h", '{"graph":"usage","range":"24h"}\n'],
    ["usage", "7d", '{"graph":"usage","range":"7d"}\n'],
    ["usage", "30d", '{"graph":"usage","range":"30d"}\n'],
    ["health", "24h", '{"graph":"health","range":"24h"}\n'],
    ["health", "7d", '{"graph":"health","range":"7d"}\n'],
    ["health", "30d", '{"graph":"health","range":"30d"}\n'],
  ]
  for (const [graph, range, json] of table) {
    assert.equal(UiState.serialize({ graph, range }), json)
    assert.deepEqual(plain(UiState.parse(json)), { graph, range })
  }
})

test("isGraph and isRange accept exactly the listed values", () => {
  assert.equal(UiState.isGraph("level"), true)
  assert.equal(UiState.isGraph("health"), true)
  assert.equal(UiState.isGraph("Level"), false)
  assert.equal(UiState.isGraph(""), false)
  assert.equal(UiState.isGraph(undefined), false)
  assert.equal(UiState.isRange("30d"), true)
  assert.equal(UiState.isRange("1h"), false)
  assert.equal(UiState.isRange(24), false)
})
