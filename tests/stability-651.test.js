"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { claimsPreparedWebsite } = require("../lib/gemini-message");

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

console.log("Stability 6.5.1 — claims + ensure\n");

test("PT positive: preparei o vosso website", function () {
  assert.ok(claimsPreparedWebsite("Preparei o vosso website e gostava de apresentar em 10-15 min."));
});
test("PT positive: o site está preparado", function () {
  assert.ok(claimsPreparedWebsite("O site está preparado para a vossa empresa; conversa de 10 minutos."));
});
test("ES positive: he preparado vuestro sitio web", function () {
  assert.ok(claimsPreparedWebsite("He preparado vuestro sitio web y me gustaría presentarlo en 10-15 minutos."));
});
test("ES positive: el sitio web está preparado", function () {
  assert.ok(claimsPreparedWebsite("El sitio web está preparado; podemos hablar 15 minutos."));
});
test("EN positive: I have prepared your website", function () {
  assert.ok(claimsPreparedWebsite("I have prepared your website and would like a 10-15 minute call."));
});
test("EN positive: the website is ready", function () {
  assert.ok(claimsPreparedWebsite("The website is ready — can we talk for 10 minutes?"));
});

test("reject incomplete ES he preparado", function () {
  assert.ok(!claimsPreparedWebsite("He preparado algo interesante para mostrar."));
  assert.ok(!claimsPreparedWebsite("he preparado"));
});
test("reject incomplete PT preparei", function () {
  assert.ok(!claimsPreparedWebsite("Preparei"));
  assert.ok(!claimsPreparedWebsite("Preparei algo para vos mostrar."));
});
test("reject incomplete EN I have prepared", function () {
  assert.ok(!claimsPreparedWebsite("I have prepared"));
  assert.ok(!claimsPreparedWebsite("I have prepared something interesting."));
});
test("reject website mention without prepared claim", function () {
  assert.ok(!claimsPreparedWebsite("Visit the website for more info."));
  assert.ok(!claimsPreparedWebsite("We have a great website online already."));
  assert.ok(!claimsPreparedWebsite("Olá, trabalho com websites profissionais."));
});

test("ensure-gemini-commercial is idempotent", function () {
  const script = path.join(__dirname, "..", "scripts", "ensure-gemini-commercial.js");
  const r1 = spawnSync(process.execPath, [script], { encoding: "utf8" });
  const r2 = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.strictEqual(r1.status, 0, r1.stderr || r1.stdout);
  assert.strictEqual(r2.status, 0, r2.stderr || r2.stdout);
  assert.ok(
    /markers present|optional patches|already applied|strict claims|wrote stability/i.test(
      (r2.stdout || "") + (r2.stderr || "")
    )
  );
});

test("ensure-server-hardening is idempotent", function () {
  const script = path.join(__dirname, "..", "scripts", "ensure-server-hardening.js");
  const r1 = spawnSync(process.execPath, [script], { encoding: "utf8" });
  const r2 = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.strictEqual(r1.status, 0, r1.stderr || r1.stdout);
  assert.strictEqual(r2.status, 0, r2.stderr || r2.stdout);
  const out2 = (r2.stdout || "") + (r2.stderr || "");
  assert.ok(/already applied|updated/i.test(out2));
});

test("server.js uncaughtException exits process", function () {
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "ensure-server-hardening.js")], {
    encoding: "utf8"
  });
  assert.strictEqual(r.status, 0);
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  if (src.includes("uncaughtException")) {
    assert.ok(src.includes("process.exit(1)"), "uncaughtException handler must call process.exit(1)");
    assert.ok(!src.includes("Do not process.exit — keep Express alive"), "dangerous keep-alive comment must not remain");
  }
});

test("apify-search exports timeout helpers", function () {
  const apify = require("../lib/apify-search");
  assert.ok(typeof apify.fetchWithTimeout === "function");
  assert.ok(typeof apify.classifyHttpError === "function");
  assert.ok(apify.START_TIMEOUT_MS > 0);
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
