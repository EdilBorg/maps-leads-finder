"use strict";
/**
 * Ensures lib/gemini-message.js contains the commercial strategy markers.
 * Does NOT rebuild from incomplete g*.b64 placeholders (that previously
 * overwrote a working module with garbage). Idempotent soft check only.
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
  "startsWithPersonalFirstName"
];

const missing = markers.filter(function (m) {
  return src.indexOf(m) === -1;
});

if (!missing.length) {
  console.log("[ensure-gemini-commercial] strategy markers present — ok");
  process.exit(0);
}

console.warn(
  "[ensure-gemini-commercial] missing markers in lib/gemini-message.js:",
  missing.join(", ")
);
console.warn(
  "[ensure-gemini-commercial] not overwriting from g*.b64 (placeholders disabled). Fix the source module in the repository."
);
// Soft fail: do not kill boot; production still starts with whatever is on disk.
process.exit(0);
