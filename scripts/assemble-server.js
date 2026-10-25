"use strict";
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "parts");
const files = fs
  .readdirSync(dir)
  .filter((f) => /^s\d+\.b64$/.test(f))
  .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
const b64 = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim()).join("");
const out = path.join(__dirname, "..", "server.runtime.js");
fs.writeFileSync(out, Buffer.from(b64, "base64"));
module.exports = out;
