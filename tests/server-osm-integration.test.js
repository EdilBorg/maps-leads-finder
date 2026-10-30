"use strict";
/**
 * Validates that production server.js permanently uses lib/osm-search.js
 * and lib/apify-search.js (not abandoned inline implementations).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "..", "server.js");
const src = fs.readFileSync(serverPath, "utf8");

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

console.log("Server ↔ OSM/Apify integration (main production code)\n");

test("server requires lib/osm-search", function () {
  assert.ok(
    src.includes('require("./lib/osm-search")') || src.includes("require('./lib/osm-search')"),
    "missing osm-search require"
  );
});

test("searchOpenStreetMap delegates to osmSearch", function () {
  assert.ok(/return\s+osmSearch\.searchOpenStreetMap\s*\(/.test(src));
});

test("no shared AbortController loop in searchOpenStreetMap body", function () {
  const start = src.indexOf("async function searchOpenStreetMap");
  const end = src.indexOf("async function searchApify", start);
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(!body.includes("for (const endpoint of OVERPASS_ENDPOINTS)"), "inline endpoint loop still present");
  assert.ok(body.includes("timeoutMs:"));
});

test("server requires lib/apify-search", function () {
  assert.ok(src.includes('require("./lib/apify-search")'));
});

test("searchApify delegates to apifySearch", function () {
  assert.ok(/return\s+apifySearch\.searchApify\s*\(/.test(src));
});

test("hasOsm reflects endpoints configuration", function () {
  assert.ok(src.includes("OVERPASS_ENDPOINTS.length"));
  assert.ok(!/function hasOsm\(\)\s*\{\s*return true;\s*\}/.test(src));
});

test("uncaughtException exits process", function () {
  assert.ok(src.includes("uncaughtException"));
  assert.ok(src.includes("process.exit(1)"));
  assert.ok(!src.includes("Do not process.exit — keep Express alive"));
});

test("status reports version 6.6.x and configured flags", function () {
  assert.ok(/version:\s*"6\.6\./.test(src));
  assert.ok(src.includes("osmConfigured"));
  assert.ok(src.includes("apifyConfigured"));
});

test("static assets set Cache-Control no-cache for js/css", function () {
  assert.ok(src.includes("setHeaders"));
  assert.ok(src.includes("no-cache"));
});

test("lib/osm-search exports production searchOpenStreetMap", function () {
  const mod = require("../lib/osm-search");
  assert.strictEqual(typeof mod.searchOpenStreetMap, "function");
});

test("lib/apify-search exports production searchApify with timeouts", function () {
  const mod = require("../lib/apify-search");
  assert.strictEqual(typeof mod.searchApify, "function");
  assert.strictEqual(typeof mod.fetchWithTimeout, "function");
  assert.ok(mod.START_TIMEOUT_MS > 0);
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
