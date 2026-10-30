"use strict";
/**
 * Ensures lib/gemini-message.js contains the commercial strategy + stability markers.
 * If critical 6.5.0 markers are missing, assembles from scripts/gm0.b64..gm5.b64.
 * Never overwrites a module that already has the required markers.
 */
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "lib", "gemini-message.js");
let src = "";
try {
  src = fs.readFileSync(target, "utf8");
} catch (e) {
  src = "";
}

const markers = [
  "function systemPromptRules",
  "websitePrepStatus",
  "claimsPreparedWebsite",
  "STRATEGY_VERSION",
  "CINCO PASSOS",
  "startsWithPersonalFirstName",
  "isQuotaExhaustedBody",
  "GEMINI_QUOTA_EXCEEDED",
  "skipListingFallback",
  "work.then(cleanup, cleanup)"
];

const missing = markers.filter(function (m) {
  return src.indexOf(m) === -1;
});

if (!missing.length) {
  console.log("[ensure-gemini-commercial] strategy + stability markers present — ok");
  process.exit(0);
}

console.warn(
  "[ensure-gemini-commercial] missing markers:",
  missing.join(", ")
);

// Try assemble from gm0-gm5.b64
const parts = [];
for (let i = 0; i < 6; i++) {
  const p = path.join(__dirname, "gm" + i + ".b64");
  if (!fs.existsSync(p)) {
    console.warn("[ensure-gemini-commercial] missing chunk", p);
    console.warn("[ensure-gemini-commercial] not overwriting module; fix lib/gemini-message.js in the repository");
    process.exit(0);
  }
  parts.push(fs.readFileSync(p, "utf8").replace(/\s+/g, ""));
}

try {
  const buf = Buffer.from(parts.join(""), "base64");
  const assembled = buf.toString("utf8");
  if (assembled.indexOf("isQuotaExhaustedBody") === -1 || assembled.indexOf("generateCommercialMessage") === -1) {
    console.warn("[ensure-gemini-commercial] assembled payload invalid — not writing");
    process.exit(0);
  }
  fs.writeFileSync(target, assembled);
  console.log("[ensure-gemini-commercial] assembled lib/gemini-message.js from gm0-gm5.b64 (" + assembled.length + " bytes)");
} catch (e) {
  console.warn("[ensure-gemini-commercial] assemble failed:", e && e.message ? e.message : e);
}
process.exit(0);
