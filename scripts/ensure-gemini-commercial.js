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
if (fs.existsSync(a) && fs.existsSync(b)) {
  const b64 = (fs.readFileSync(a, "utf8") + fs.readFileSync(b, "utf8")).replace(/\s+/g, "");
  fs.writeFileSync(target, Buffer.from(b64, "base64"));
  console.log("[ensure-gemini-commercial] lib/gemini-message.js updated from payload");
  process.exit(0);
}
console.warn("[ensure-gemini-commercial] payload parts missing; leaving existing lib/gemini-message.js unchanged");
process.exit(0);
