"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
  assert.ok(!m.startsWith("user@"));
  assert.ok(m.includes("*"));
});

test("server.js is a real Express app entry (not bootstrap parts)", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const core = fs.readFileSync(path.join(__dirname, "..", "lib", "app-core.js"), "utf8");
  const placeNorm = fs.readFileSync(
    path.join(__dirname, "..", "lib", "place-normalize.js"),
    "utf8"
  );
  assert.ok(server.includes('require("express")') || server.includes("require('express')"));
  assert.ok(server.includes("requireAuth"));
  assert.ok(
    server.includes('require("./lib/app-core")') || server.includes("require('./lib/app-core')")
  );
  assert.ok(!server.includes("server-parts"));
  assert.ok(!server.includes("assemble-server"));
  assert.ok(core.includes("/api/search"));
  assert.ok(core.includes("/api/locale-options"));
  assert.ok(placeNorm.includes("googlePlaceId"));
  assert.ok(placeNorm.includes("osmId"));
});

test("search lib modules load without missing requires", () => {
  const createSearchLib = require("../lib/search-lib");
  const locale = require("../lib/locale");
  const leadFields = require("../lib/lead-fields");
  const lib = createSearchLib({
    fetch: async () => ({ ok: false, status: 500, text: async () => "" }),
    locale,
    leadFields
  });
  assert.strictEqual(typeof lib.hasApify, "function");
  assert.strictEqual(typeof lib.hasOsm, "function");
  assert.strictEqual(typeof lib.searchOpenStreetMap, "function");
  assert.strictEqual(typeof lib.searchApify, "function");
  assert.strictEqual(typeof lib.searchCombined, "function");
  assert.strictEqual(typeof lib.dedupeAndMerge, "function");
  assert.strictEqual(typeof lib.applyFilters, "function");
  assert.strictEqual(typeof lib.friendlyError, "function");
  assert.ok(lib.hasOsm());
});

test("place-constants exports required symbols", () => {
  const createPlaceConstants = require("../lib/place-constants");
  const c = createPlaceConstants({ fetch: async () => ({}) });
  assert.ok(Array.isArray(c.OVERPASS_ENDPOINTS) && c.OVERPASS_ENDPOINTS.length >= 1);
  assert.strictEqual(typeof c.geocodeLocation, "function");
  assert.strictEqual(typeof c.buildOverpassQuery, "function");
  assert.strictEqual(typeof c.isOfficialWebsite, "function");
  assert.strictEqual(typeof c.hasApify, "function");
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
