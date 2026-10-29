"use strict";
const fs = require("fs");
const path = require("path");
const target = path.join(__dirname, "..", "lib", "gemini-message.js");
let src = "";
try { src = fs.readFileSync(target, "utf8"); } catch (e) { src = ""; }
if (src.includes("function systemPromptRules") && src.includes("websitePrepStatus") && src.includes("startsWithPersonalFirstName")) {
  console.log("[ensure-gemini-commercial] already applied");
  process.exit(0);
}
const a = path.join(__dirname, "gemini-message.payload.a.b64");
const b = path.join(__dirname, "gemini-message.payload.b.b64");
if (!fs.existsSync(a) || !fs.existsSync(b)) {
  console.error("[ensure-gemini-commercial] missing payload parts");
  process.exit(1);
}
const b64 = (fs.readFileSync(a, "utf8") + fs.readFileSync(b, "utf8")).replace(/\s+/g, "");
const buf = Buffer.from(b64, "base64");
fs.writeFileSync(target, buf);
console.log("[ensure-gemini-commercial] lib/gemini-message.js updated (" + buf.length + " bytes)");
