"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..");
const out = path.join(root, "server.js");
function isComplete(s) {
  return s && s.includes("return osmSearch.searchOpenStreetMap") && s.includes("async function searchApify") && s.includes("app.listen") && s.length > 20000;
}
let existing = "";
try { existing = fs.readFileSync(out, "utf8"); } catch (_) {}
if (isComplete(existing)) {
  console.log("[install-server] server.js already complete permanent");
  process.exit(0);
}
const dir = path.join(__dirname, "server-blob");
const files = fs.readdirSync(dir).filter(f => /^p\d+\.js$/.test(f)).sort((a,b) => parseInt(a.slice(1),10) - parseInt(b.slice(1),10));
if (!files.length) {
  console.error("[install-server] missing lib/server-blob parts");
  process.exit(1);
}
const b64 = files.map(f => require(path.join(dir, f))).join("");
const body = zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
if (!isComplete(body)) {
  console.error("[install-server] assembled server invalid", body.length);
  process.exit(1);
}
fs.writeFileSync(out, body);
console.log("[install-server] wrote complete permanent server.js", body.length);
