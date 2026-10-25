"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Module = require("module");

const b64 = fs.readFileSync(path.join(__dirname, "search-app.js.gz.b64"), "utf8");
const src = zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
const filename = path.join(__dirname, "search-app.decoded.js");
const m = new Module(filename, module);
m.filename = filename;
m.paths = Module._nodeModulePaths(path.join(__dirname, ".."));
m._compile(src, filename);
module.exports = m.exports;
