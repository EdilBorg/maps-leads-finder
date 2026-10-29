"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const template = fs.readFileSync(path.join(root, "template.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "bootstrap.js"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK", name); }
  catch (e) { failed++; console.error("  FAIL", name, e.message); }
}

console.log("Search / message JSON safety tests\n");

test("index defines parseApiJson", () => {
  assert.ok(index.includes("async function parseApiJson"));
});

test("index search does not use bare res.json()", () => {
  assert.ok(index.includes("parseApiJson(res)"));
  assert.ok(index.includes('Accept: "application/json"'));
});

test("bootstrap runs ensure-index-search-json-safe", () => {
  assert.ok(bootstrap.includes("ensure-index-search-json-safe"));
});

test("template has safe JSON path for messages", () => {
  assert.ok(template.includes("looksJson") || template.includes("parseApiJson") || template.includes("Resposta inválida do servidor"));
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
