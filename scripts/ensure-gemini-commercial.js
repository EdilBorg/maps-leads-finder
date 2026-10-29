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
try {
  let b64 = "";
  for (let i = 0; i < 4; i++) {
    b64 += fs.readFileSync(path.join(__dirname, "g" + i + ".b64"), "utf8").replace(/\s+/g, "");
  }
  fs.writeFileSync(target, Buffer.from(b64, "base64"));
  console.log("[ensure-gemini-commercial] assembled from g0-g3.b64");
} catch (e) {
  console.warn("[ensure-gemini-commercial]", e.message);
}
process.exit(0);
