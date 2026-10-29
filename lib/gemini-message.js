"use strict";
const parts = [
  require("./gemini-parts/p0"),
  require("./gemini-parts/p1"),
  require("./gemini-parts/p2")
];
const src = parts.join("");
const Module = require("module");
const path = require("path");
const m = new Module(path.join(__dirname, "gemini-message.js"));
m.filename = path.join(__dirname, "gemini-message.js");
m.paths = module.paths;
m._compile(src, m.filename);
module.exports = m.exports;
