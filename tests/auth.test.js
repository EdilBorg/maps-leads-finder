"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

process.env.NODE_ENV = "test";
const otp = require("../lib/otp");
const realStore = otp.STORE_PATH;

function cleanStore() {
  try {
    if (fs.existsSync(realStore)) fs.unlinkSync(realStore);
  } catch (_) {}
  const dir = path.dirname(realStore);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  cleanStore();
  try {
    fn();
    passed += 1;
    console.log("  OK", name);
  } catch (e) {
    failed += 1;
    console.error("  FAIL", name, e.message);
  }
}

console.log("OTP / auth unit tests\n");

test("generateOtpCode returns 6 digits", () => {
  for (let i = 0; i < 20; i++) {
    const c = otp.generateOtpCode();
    assert.ok(/^\d{6}$/.test(c), "expected 6 digits, got " + c);
  }
});

test("createOtp succeeds and returns code + TTL", () => {
  const r = otp.createOtp("login", "127.0.0.1");
  assert.strictEqual(r.ok, true);
  assert.ok(/^\d{6}$/.test(r.code));
  assert.ok(r.expiresInSec > 0);
});

test("verifyOtp accepts correct code once", () => {
  const r = otp.createOtp("login", "10.0.0.1");
  assert.ok(r.ok);
  assert.strictEqual(otp.verifyOtp("login", r.code).ok, true);
});

test("verifyOtp rejects reuse", () => {
  const r = otp.createOtp("login", "10.0.0.2");
  assert.ok(r.ok);
  assert.strictEqual(otp.verifyOtp("login", r.code).ok, true);
  assert.strictEqual(otp.verifyOtp("login", r.code).ok, false);
});

test("verifyOtp rejects wrong code", () => {
  const r = otp.createOtp("login", "10.0.0.3");
  assert.ok(r.ok);
  const wrong = r.code === "000000" ? "111111" : "000000";
  assert.strictEqual(otp.verifyOtp("login", wrong).ok, false);
});

test("verifyOtp locks after MAX_VERIFY_ATTEMPTS", () => {
  const r = otp.createOtp("login", "10.0.0.4");
  assert.ok(r.ok);
  const wrong = r.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < otp.MAX_VERIFY_ATTEMPTS; i++) otp.verifyOtp("login", wrong);
  assert.strictEqual(otp.verifyOtp("login", r.code).ok, false);
});

test("resend cooldown blocks rapid createOtp", () => {
  assert.ok(otp.createOtp("login", "10.0.0.5").ok);
  const b = otp.createOtp("login", "10.0.0.5");
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.error, "cooldown");
});

test("maskEmail hides local part", () => {
  const m = otp.maskEmail("user@example.com");
  assert.ok(m.includes("@"));
  assert.ok(!m.includes("user@"));
  assert.ok(m.includes("*"));
});

test("server.js does not express.static the project root", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(!/express\.static\(\s*path\.join\(__dirname\)\s*[,)]/.test(server));
  assert.ok(server.includes("PUBLIC_ASSETS"));
});

test("session max age is 24 hours", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(server.includes("SESSION_MAX_AGE_MS"));
  assert.ok(/SESSION_MAX_AGE_MS\s*=\s*1000\s*\*\s*60\s*\*\s*60\s*\*\s*24/.test(server));
  assert.ok(!/maxAge:\s*1000\s*\*\s*60\s*\*\s*60\s*\*\s*24\s*\*\s*7/.test(server));
});

test("production refuses weak SESSION_SECRET and uses helmet", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(server.includes("process.exit(1)"));
  assert.ok(server.includes("helmet("));
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
