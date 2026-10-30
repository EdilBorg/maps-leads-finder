"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = path.join(root, "server.js");
const parts = [];
for (let i = 0; i < 20; i++) {
  const mod = path.join(root, "parts-server", "s" + i + ".js");
  if (!fs.existsSync(mod)) break;
  parts.push(require(mod));
}
if (!parts.length) {
  console.error("[write-permanent-server] no parts");
  process.exit(1);
}
const body = parts.map(p => Buffer.from(p, "base64").toString("utf8")).join("");
if (!body.includes("return osmSearch.searchOpenStreetMap") || !body.includes("async function searchApify") || !body.includes("app.listen")) {
  console.error("[write-permanent-server] assembled body invalid, len=" + body.length);
  process.exit(1);
}
fs.writeFileSync(out, body);
console.log("[write-permanent-server] wrote permanent server.js", body.length, "bytes");
