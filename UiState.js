.pragma library

// Which graph and range the HISTORY section shows. Kept in the plugin's state
// directory (ui.json), not in shell.json, so picking a graph does not rewrite
// the user's shell config. Anything unreadable falls back field by field, so
// a hand-edited or truncated file never leaves the panel without a graph.

var GRAPHS = ["level", "usage", "health"]
var RANGES = ["24h", "7d", "30d"]
var DEFAULT_GRAPH = "level"
var DEFAULT_RANGE = "24h"

// indexOf on the arrays, not `value in OBJECT`: an object lookup would accept
// prototype names such as "constructor" or "__proto__".
function isGraph(value) {
  return typeof value === "string" && GRAPHS.indexOf(value) !== -1
}

function isRange(value) {
  return typeof value === "string" && RANGES.indexOf(value) !== -1
}

function normalize(state) {
  var s = state && typeof state === "object" && !Array.isArray(state) ? state : {}
  return {
    graph: isGraph(s.graph) ? s.graph : DEFAULT_GRAPH,
    range: isRange(s.range) ? s.range : DEFAULT_RANGE
  }
}

function parse(text) {
  var data = null
  try {
    data = JSON.parse(String(text === null || text === undefined ? "" : text))
  } catch (e) {
    data = null
  }
  return normalize(data)
}

function serialize(state) {
  var s = normalize(state)
  return JSON.stringify({ graph: s.graph, range: s.range }) + "\n"
}
