"use strict";
/**
 * Confirms server.js permanently delegates to lib/osm-search.js
 * without relying on ensure scripts rewriting the OSM motor.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "server.js"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  OK", name);
  } catch (e) {
    failed++;
    console.error("  FAIL", name, e.message);
  }
}

console.log("server.js ↔ lib/osm-search.js integration\n");

test("server requires lib/osm-search as osmSearch", function () {
  assert.ok(src.includes('const osmSearch = require("./lib/osm-search")'));
});

test("searchOpenStreetMap returns osmSearch.searchOpenStreetMap", function () {
  assert.ok(/return\s+osmSearch\.searchOpenStreetMap\s*\(/.test(src));
});

test("no inline Overpass loop in searchOpenStreetMap", function () {
  const start = src.indexOf("async function searchOpenStreetMap");
  const end = src.indexOf("async function searchApify", start);
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(!body.includes("for (const endpoint of OVERPASS_ENDPOINTS)"));
  assert.ok(!body.includes("new AbortController()"));
  assert.ok(body.includes("timeoutMs:"));
});

test("Overpass query timeout is 25s (client has margin)", function () {
  assert.ok(src.includes("[timeout:25]"));
});

test("Apify search function still present (untouched)", function () {
  assert.ok(src.includes("async function searchApify"));
});

test("lib/osm-search exports production API", function () {
  const mod = require("../lib/osm-search");
  assert.strictEqual(typeof mod.searchOpenStreetMap, "function");
  assert.strictEqual(typeof mod.extractRemarkError, "function");
  assert.ok(mod.DEFAULT_TIMEOUT_MS >= 40000);
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
