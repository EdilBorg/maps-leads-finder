"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = path.join(root, "index.html");
try {
  const cur = fs.readFileSync(out, "utf8");
  if (cur.includes('id="searchBtn"') && cur.includes("startSearch") && cur.length > 15000) {
    process.exit(0);
  }
} catch (_) {}
const parts = [];
for (let i = 0; i < 10; i++) {
  const p = path.join(root, "index.part" + i + ".b64");
  if (!fs.existsSync(p)) break;
  parts.push(fs.readFileSync(p, "utf8").trim());
}
if (!parts.length) {
  console.error("[restore-index] missing index.part*.b64");
  process.exit(1);
}
const html = Buffer.from(parts.join(""), "base64").toString("utf8");
if (!html.includes('id="searchBtn"')) {
  console.error("[restore-index] decoded HTML looks invalid");
  process.exit(1);
}
fs.writeFileSync(out, html);
console.log("[restore-index] wrote index.html (" + html.length + " bytes)");
