"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 10;
const STORE_PATH = path.join(__dirname, "..", "data", "otp-store.json");

function ensureStoreDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readStore() {
  ensureStoreDir();
  try {
    if (!fs.existsSync(STORE_PATH)) return { records: {}, rate: {} };
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return { records: {}, rate: {} };
  }
}

function writeStore(store) {
  ensureStoreDir();
  const tmp = STORE_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
  fs.renameSync(tmp, STORE_PATH);
}

function generateOtpCode() {
  const max = 1000000;
  const limit = Math.floor(0x100000000 / max) * max;
  let x;
  do {
    x = crypto.randomBytes(4).readUInt32BE(0);
  } while (x >= limit);
  return String(x % max).padStart(6, "0");
}

function hashOtp(code, salt) {
  return crypto.scryptSync(String(code), salt, 32).toString("hex");
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at < 1) return "***";
  const user = s.slice(0, at);
  const domain = s.slice(at + 1);
  const u =
    user.length <= 2
      ? user[0] + "*"
      : user[0] + "***" + user[user.length - 1];
  const dParts = domain.split(".");
  const dName = dParts[0] || "";
  const dMasked =
    dName.length <= 2 ? dName[0] + "*" : dName[0] + "***";
  const tld = dParts.slice(1).join(".") || "***";
  return `${u}@${dMasked}.${tld}`;
}

function prune(store, now = Date.now()) {
  for (const key of Object.keys(store.records)) {
    const r = store.records[key];
    if (!r || r.expiresAt < now || r.consumed) delete store.records[key];
  }
  for (const ip of Object.keys(store.rate)) {
    store.rate[ip] = (store.rate[ip] || []).filter((t) => now - t < 60 * 60 * 1000);
    if (!store.rate[ip].length) delete store.rate[ip];
  }
}

function checkRateLimit(store, ip, now = Date.now()) {
  const list = (store.rate[ip] || []).filter((t) => now - t < 60 * 60 * 1000);
  store.rate[ip] = list;
  if (list.length >= MAX_REQUESTS_PER_HOUR) {
    return { ok: false, retryAfterSec: Math.ceil((list[0] + 3600000 - now) / 1000) };
  }
  return { ok: true };
}

function createOtp(purpose = "login", ip = "unknown") {
  const now = Date.now();
  const store = readStore();
  prune(store, now);

  const rate = checkRateLimit(store, ip, now);
  if (!rate.ok) {
    return { ok: false, error: "rate_limit", retryAfterSec: rate.retryAfterSec };
  }

  const existing = store.records[purpose];
  if (existing && existing.createdAt && now - existing.createdAt < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((existing.createdAt + RESEND_COOLDOWN_MS - now) / 1000);
    return { ok: false, error: "cooldown", retryAfterSec: wait };
  }

  const code = generateOtpCode();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashOtp(code, salt);

  store.records[purpose] = {
    hash,
    salt,
    expiresAt: now + OTP_TTL_MS,
    createdAt: now,
    attempts: 0,
    consumed: false,
    purpose
  };
  store.rate[ip] = store.rate[ip] || [];
  store.rate[ip].push(now);
  writeStore(store);

  return {
    ok: true,
    code,
    expiresAt: now + OTP_TTL_MS,
    expiresInSec: Math.floor(OTP_TTL_MS / 1000)
  };
}

function verifyOtp(purpose, code) {
  const now = Date.now();
  const store = readStore();
  prune(store, now);

  const record = store.records[purpose];
  if (!record) {
    return { ok: false, error: "invalid_or_expired" };
  }
  if (record.consumed) {
    return { ok: false, error: "already_used" };
  }
  if (record.expiresAt < now) {
    delete store.records[purpose];
    writeStore(store);
    return { ok: false, error: "invalid_or_expired" };
  }
  if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
    delete store.records[purpose];
    writeStore(store);
    return { ok: false, error: "too_many_attempts" };
  }

  const candidate = String(code || "").trim();
  if (!/^\d{6}$/.test(candidate)) {
    record.attempts += 1;
    writeStore(store);
    return { ok: false, error: "invalid_or_expired" };
  }

  const hash = hashOtp(candidate, record.salt);
  const match = safeEqualHex(hash, record.hash);
  if (!match) {
    record.attempts += 1;
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      delete store.records[purpose];
    }
    writeStore(store);
    return { ok: false, error: "invalid_or_expired" };
  }

  record.consumed = true;
  delete store.records[purpose];
  writeStore(store);
  return { ok: true };
}

module.exports = {
  generateOtpCode,
  createOtp,
  verifyOtp,
  maskEmail,
  hashOtp,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  MAX_VERIFY_ATTEMPTS,
  STORE_PATH
};
