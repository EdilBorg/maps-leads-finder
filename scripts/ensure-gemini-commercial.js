"use strict";
/**
 * Ensures lib/gemini-message.js contains the commercial strategy markers.
 * Does not overwrite a working module with incomplete base64 payloads.
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
  "[ensure-gemini-commercial] missing markers:",
  missing.join(", ")
);
console.warn(
  "[ensure-gemini-commercial] not overwriting module; fix lib/gemini-message.js in the repository"
);
process.exit(0);
