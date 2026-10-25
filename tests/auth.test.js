"use strict";

/**
 * Unit tests for OTP + auth helpers (no live SMTP / no production).
 * Run: npm test
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mlf-otp-"));
process.env.NODE_ENV = "test";

const otp = require("../lib/otp");

const realStore = otp.STORE_PATH;
const testStore = path.join(tmpRoot, "otp-store.json");

function cleanStore() {
  try {
    if (fs.existsSync(testStore)) fs.unlinkSync(testStore);
  } catch (_) {}
  try {
    if (fs.existsSync(realStore)) fs.unlinkSync(realStore);
  } catch (_) {}
  const dir = path.dirname(realStore);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(realStore)) fs.unlinkSync(realStore);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  cleanStore();
  try {
    fn();
    passed += 1;
    console.log("  ✓", name);
  } catch (e) {
    failed += 1;
    console.error("  ✗", name);
    console.error("   ", e.message);
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
  assert.ok(r.expiresInSec <= Math.floor(otp.OTP_TTL_MS / 1000));
});

test("verifyOtp accepts correct code once", () => {
  const r = otp.createOtp("login", "10.0.0.1");
  assert.ok(r.ok);
  const v = otp.verifyOtp("login", r.code);
  assert.strictEqual(v.ok, true);
});

test("verifyOtp rejects reuse of same code", () => {
  const r = otp.createOtp("login", "10.0.0.2");
  assert.ok(r.ok);
  assert.strictEqual(otp.verifyOtp("login", r.code).ok, true);
  const again = otp.verifyOtp("login", r.code);
  assert.strictEqual(again.ok, false);
});

test("verifyOtp rejects wrong code", () => {
  const r = otp.createOtp("login", "10.0.0.3");
  assert.ok(r.ok);
  const wrong = r.code === "000000" ? "111111" : "000000";
  const v = otp.verifyOtp("login", wrong);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.error, "invalid_or_expired");
});

test("verifyOtp locks after MAX_VERIFY_ATTEMPTS", () => {
  const r = otp.createOtp("login", "10.0.0.4");
  assert.ok(r.ok);
  const wrong = r.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < otp.MAX_VERIFY_ATTEMPTS; i++) {
    otp.verifyOtp("login", wrong);
  }
  const last = otp.verifyOtp("login", r.code);
  assert.strictEqual(last.ok, false);
});

test("resend cooldown blocks rapid createOtp", () => {
  const a = otp.createOtp("login", "10.0.0.5");
  assert.ok(a.ok);
  const b = otp.createOtp("login", "10.0.0.5");
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.error, "cooldown");
  assert.ok(b.retryAfterSec > 0);
});

test("maskEmail hides local part", () => {
  const m = otp.maskEmail("user@example.com");
  assert.ok(m.includes("@"), m);
  assert.ok(!m.includes("user@"), m);
  assert.ok(m.includes("*"), m);
});

test("hashOtp is deterministic for same inputs", () => {
  const h1 = otp.hashOtp("123456", "salt");
  const h2 = otp.hashOtp("123456", "salt");
  assert.strictEqual(h1, h2);
  assert.notStrictEqual(otp.hashOtp("123456", "other"), h1);
});

test("server.js does not express.static the project root", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(
    !/express\.static\(\s*path\.join\(__dirname\)\s*[,)]/.test(server),
    "express.static(__dirname) must not be used"
  );
  assert.ok(server.includes("PUBLIC_ASSETS"), "expected PUBLIC_ASSETS allowlist");
});

test("session max age is 24 hours", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(server.includes("SESSION_MAX_AGE_MS"), "SESSION_MAX_AGE_MS constant missing");
  assert.ok(
    /SESSION_MAX_AGE_MS\s*=\s*1000\s*\*\s*60\s*\*\s*60\s*\*\s*24/.test(server),
    "session must be 24h"
  );
  assert.ok(!/maxAge:\s*1000\s*\*\s*60\s*\*\s*60\s*\*\s*24\s*\*\s*7/.test(server), "7-day cookie must be removed");
});

test("production refuses weak SESSION_SECRET", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.ok(server.includes("process.exit(1)"), "must exit when misconfigured in production");
  assert.ok(server.includes("helmet("), "helmet must be enabled");
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
