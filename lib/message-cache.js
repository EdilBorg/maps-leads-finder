"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CACHE_DIR = path.join(__dirname, "..", "data", "message-cache");
const STRATEGY_VERSION = "msg-strategy-v1";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function stableLeadKey(lead) {
  if (!lead || typeof lead !== "object") return "unknown";
  const id =
    (lead.googlePlaceId && String(lead.googlePlaceId).trim()) ||
    (lead.osmId && String(lead.osmId).trim()) ||
    "";
  if (id) return id.toLowerCase();
  const name = String(lead.name || "").toLowerCase().trim();
  const city = String(lead.city || "").toLowerCase().trim();
  const phone = String(lead.phone || "").replace(/\D/g, "");
  return [name, city, phone].filter(Boolean).join("|") || "unknown";
}

function cacheKey(lead, commercialCountry, explicitLanguage) {
  const raw = [
    STRATEGY_VERSION,
    stableLeadKey(lead),
    String(commercialCountry || "").toUpperCase(),
    String(explicitLanguage || "").toLowerCase()
  ].join("::");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function filePath(key) {
  return path.join(CACHE_DIR, key + ".json");
}

function get(lead, commercialCountry, explicitLanguage, ttlMs) {
  ensureDir();
  const key = cacheKey(lead, commercialCountry, explicitLanguage);
  const fp = filePath(key);
  try {
    if (!fs.existsSync(fp)) return null;
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    const ttl = ttlMs != null ? ttlMs : DEFAULT_TTL_MS;
    if (!data || !data.createdAt || Date.now() - data.createdAt > ttl) return null;
    if (data.strategyVersion !== STRATEGY_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

function set(lead, commercialCountry, explicitLanguage, payload) {
  ensureDir();
  const key = cacheKey(lead, commercialCountry, explicitLanguage);
  const entry = {
    strategyVersion: STRATEGY_VERSION,
    createdAt: Date.now(),
    commercialCountry: commercialCountry || "",
    explicitLanguage: explicitLanguage || "",
    leadKey: stableLeadKey(lead),
    ...payload
  };
  fs.writeFileSync(filePath(key), JSON.stringify(entry), "utf8");
  return entry;
}

module.exports = {
  STRATEGY_VERSION,
  DEFAULT_TTL_MS,
  stableLeadKey,
  cacheKey,
  get,
  set,
  CACHE_DIR
};
