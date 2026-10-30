"use strict";
/**
 * Validates production server.js permanently uses lib/osm-search.js
 * (no dependency on ensure scripts for the OSM motor itself).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
// Apply ensure so base server on main is patched to production path if needed
for (const script of ["scripts/ensure-server-hardening.js", "scripts/ensure-apify-fix.js", "scripts/ensure-message-route.js"]) {
  const r = spawnSync(process.execPath, [path.join(root, script)], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    console.error(script, "failed", r.stdout, r.stderr);
    process.exit(1);
  }
}

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

console.log("Server ↔ OSM permanent integration\n");

test("server requires lib/osm-search as osmSearch", function () {
  assert.ok(src.includes('const osmSearch = require("./lib/osm-search")') || src.includes('require("./lib/osm-search")'));
});

test("searchOpenStreetMap is a thin wrapper to osmSearch", function () {
  assert.ok(/return\s+osmSearch\.searchOpenStreetMap\s*\(/.test(src));
});

test("no inline Overpass endpoint loop in searchOpenStreetMap", function () {
  const start = src.indexOf("async function searchOpenStreetMap");
  const end = src.indexOf("async function searchApify", start);
  assert.ok(start >= 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(!body.includes("for (const endpoint of OVERPASS_ENDPOINTS)"));
  assert.ok(body.includes("timeoutMs:"));
});

test("lib/osm-search is the production implementation", function () {
  const mod = require("../lib/osm-search");
  assert.strictEqual(typeof mod.searchOpenStreetMap, "function");
  assert.strictEqual(typeof mod.probeOverpassAvailability, "function");
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
