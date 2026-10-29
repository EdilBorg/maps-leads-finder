"use strict";
/**
 * Ensures lib/gemini-message.js contains the commercial strategy.
 * If markers are missing, assembles the module from scripts/g0.b64 … g3.b64.
 * Soft-fails without killing the process if payload is incomplete.
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
  missing.join(", "),
  "— assembling from g0-g3.b64"
);

try {
  let b64 = "";
  for (let i = 0; i < 4; i++) {
    const p = path.join(__dirname, "g" + i + ".b64");
    const chunk = fs.readFileSync(p, "utf8").replace(/\s+/g, "");
    if (!chunk || chunk.indexOf("PLACEHOLDER") === 0) {
      throw new Error("invalid or placeholder payload in g" + i + ".b64");
    }
    b64 += chunk;
  }
  const buf = Buffer.from(b64, "base64");
  const text = buf.toString("utf8");
  if (text.indexOf("function systemPromptRules") === -1 || text.indexOf("STRATEGY_VERSION") === -1) {
    throw new Error("assembled payload missing strategy markers");
  }
  fs.writeFileSync(target, text);
  console.log("[ensure-gemini-commercial] assembled lib/gemini-message.js (" + text.length + " bytes)");
} catch (e) {
  console.warn("[ensure-gemini-commercial] assemble failed:", e.message);
  console.warn("[ensure-gemini-commercial] leaving existing module in place; fix payload on next deploy");
}
process.exit(0);
