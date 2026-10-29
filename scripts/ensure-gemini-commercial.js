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
const p1 = path.join(__dirname, "gemini-src-part1.txt");
const p2 = path.join(__dirname, "gemini-src-part2.txt");
if (fs.existsSync(p1) && fs.existsSync(p2)) {
  fs.writeFileSync(target, fs.readFileSync(p1, "utf8") + fs.readFileSync(p2, "utf8"));
  console.log("[ensure-gemini-commercial] lib/gemini-message.js assembled from source parts");
  process.exit(0);
}
console.warn("[ensure-gemini-commercial] source parts missing; leaving module unchanged");
process.exit(0);
