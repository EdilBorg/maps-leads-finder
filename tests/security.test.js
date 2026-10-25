"use strict";

const assert = require("assert");
const { isSensitivePath } = require("../lib/public-assets");
const { createRateLimiter } = require("../lib/rate-limit");

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log("OK ", name);
  } catch (e) {
    fail++;
    console.log("FAIL", name, e.message);
  }
}

test("blocks .env", () => assert.strictEqual(isSensitivePath("/.env"), true));
test("blocks .env.local", () => assert.strictEqual(isSensitivePath("/.env.local"), true));
test("blocks data otp store", () => assert.strictEqual(isSensitivePath("/data/otp-store.json"), true));
test("blocks sessions", () => assert.strictEqual(isSensitivePath("/data/sessions/x.json"), true));
test("blocks lib", () => assert.strictEqual(isSensitivePath("/lib/otp.js"), true));
test("blocks server.js", () => assert.strictEqual(isSensitivePath("/server.js"), true));
test("blocks package.json", () => assert.strictEqual(isSensitivePath("/package.json"), true));
test("blocks node_modules", () => assert.strictEqual(isSensitivePath("/node_modules/express/index.js"), true));
test("allows styles.css", () => assert.strictEqual(isSensitivePath("/styles.css"), false));
test("allows login.css", () => assert.strictEqual(isSensitivePath("/login.css"), false));
test("allows history.js", () => assert.strictEqual(isSensitivePath("/history.js"), false));
test("blocks path traversal", () => assert.strictEqual(isSensitivePath("/styles.css/../../.env"), true));

test("rate limiter blocks after max", () => {
  const rl = createRateLimiter({ windowMs: 60_000, max: 3 });
  assert.ok(rl("ip1").ok);
  assert.ok(rl("ip1").ok);
  assert.ok(rl("ip1").ok);
  assert.strictEqual(rl("ip1").ok, false);
  assert.ok(rl("ip2").ok);
});

console.log("\nPassed:", pass, "Failed:", fail);
process.exit(fail ? 1 : 0);
