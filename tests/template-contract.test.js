"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const template = fs.readFileSync(path.join(root, "template.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK", name); }
  catch (e) { failed++; console.error("  FAIL", name, e.message); }
}

console.log("Template / server contract tests\n");

test("template has no DEFAULT_TEMPLATE / fillTemplate legacy", () => {
  assert.ok(!template.includes("DEFAULT_TEMPLATE"));
  assert.ok(!template.includes("fillTemplate"));
  assert.ok(!template.includes("sem compromisso"));
});

test("Msg and WA+ both call openCompose", () => {
  assert.ok(template.includes("window.copyLeadMessageFromBtn"));
  assert.ok(template.includes("window.openWhatsAppFromBtn"));
  assert.ok(template.includes("openCompose(btn)"));
  assert.ok(template.includes('fetch("/api/messages/generate"'));
});

test("template does not open WhatsApp before generation completes in openCompose", () => {
  const openWa = template.match(/window\.openWhatsAppFromBtn\s*=\s*function\s*\(btn\)\s*\{[^}]+\}/);
  assert.ok(openWa);
  assert.ok(!openWa[0].includes("wa.me"));
});

test("index loads template with cache-bust query", () => {
  assert.ok(/template\.js\?v=/.test(index));
});

test("server mounts message routes", () => {
  assert.ok(server.includes("mountMessageRoutes"));
  assert.ok(server.includes('require("./lib/message-routes")'));
});

test("server static sets no-cache for js/css", () => {
  assert.ok(server.includes("no-cache"));
  assert.ok(server.includes("setHeaders"));
});

test("OSM delegates to lib/osm-search (production implementation)", () => {
  assert.ok(server.includes('require("./lib/osm-search")') || server.includes("require('./lib/osm-search')"));
  assert.ok(server.includes("osmSearch.searchOpenStreetMap"));
  const osmLib = fs.readFileSync(path.join(root, "lib/osm-search.js"), "utf8");
  const loopIdx = osmLib.indexOf("for (const endpoint");
  const ctrlIdx = osmLib.indexOf("new AbortController()");
  assert.ok(loopIdx >= 0 && ctrlIdx > loopIdx, "AbortController must be inside endpoint loop in lib/osm-search.js");
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
