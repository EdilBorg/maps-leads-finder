"use strict";
const fs = require("fs");
const path = require("path");
const target = path.join(__dirname, "..", "lib", "gemini-message.js");
const payloadPath = path.join(__dirname, "gemini-message.payload.b64");
let src = "";
try { src = fs.readFileSync(target, "utf8"); } catch (e) { src = ""; }
if (src.includes("function systemPromptRules") && src.includes("websitePrepStatus") && src.includes("startsWithPersonalFirstName")) {
  console.log("[ensure-gemini-commercial] already applied");
  process.exit(0);
}
if (!fs.existsSync(payloadPath)) {
  console.error("[ensure-gemini-commercial] missing gemini-message.payload.b64");
  process.exit(1);
}
const buf = Buffer.from(fs.readFileSync(payloadPath, "utf8").replace(/\s+/g, ""), "base64");
fs.writeFileSync(target, buf);
console.log("[ensure-gemini-commercial] lib/gemini-message.js updated (" + buf.length + " bytes)");
