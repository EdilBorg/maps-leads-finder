"use strict";
/**
 * Ensures lib/gemini-message.js contains the commercial strategy.
 * If markers are missing, assembles from scripts/gf0.b64 … gf5.b64
 * (or legacy g0.b64 … g3.b64). Soft-fails without killing the process.
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
  "— assembling payload"
);

function tryAssemble(prefix, count) {
  let b64 = "";
  for (let i = 0; i < count; i++) {
    const p = path.join(__dirname, prefix + i + ".b64");
    const chunk = fs.readFileSync(p, "utf8").replace(/\s+/g, "");
    if (!chunk || chunk.indexOf("PLACEHOLDER") === 0 || chunk.indexOf("test_") === 0) {
      throw new Error("invalid payload in " + prefix + i + ".b64");
    }
    b64 += chunk;
  }
  const text = Buffer.from(b64, "base64").toString("utf8");
  if (text.indexOf("function systemPromptRules") === -1 || text.indexOf("STRATEGY_VERSION") === -1) {
    throw new Error("assembled payload missing strategy markers");
  }
  return text;
}

try {
  let text;
  try {
    text = tryAssemble("gf", 6);
  } catch (e1) {
    text = tryAssemble("g", 4);
  }
  fs.writeFileSync(target, text);
  console.log("[ensure-gemini-commercial] assembled lib/gemini-message.js (" + text.length + " bytes)");
} catch (e) {
  console.warn("[ensure-gemini-commercial] assemble failed:", e.message);
  console.warn("[ensure-gemini-commercial] leaving existing module in place");
}
process.exit(0);
