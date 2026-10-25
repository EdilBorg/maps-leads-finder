/**
 * Maps Leads Finder - Backend
 * Motores: OpenStreetMap (Overpass) + Apify
 * Auth: OTP email + sessões seguras
 *
 * Message-prep: loads assembled runtime if parts exist, else this file is the entry.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const partsDir = path.join(__dirname, "server-parts");
if (fs.existsSync(partsDir)) {
  const files = fs.readdirSync(partsDir).filter((f) => /^p\d+\.txt$/.test(f)).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  if (files.length) {
    const body = files.map((f) => fs.readFileSync(path.join(partsDir, f), "utf8")).join("");
    const runtime = path.join(__dirname, "server.runtime.js");
    fs.writeFileSync(runtime, body);
    require(runtime);
    return;
  }
}
console.error("[boot] server-parts missing; refusing to start incomplete build");
process.exit(1);
