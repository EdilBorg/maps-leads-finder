"use strict";
const fs = require("fs");
const path = require("path");
const indexPath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf8");
if (html.includes("styles-msg.css")) {
  console.log("[ensure-msg-styles] already linked");
  process.exit(0);
}
if (html.includes('href="styles.css"')) {
  html = html.replace(
    'href="styles.css"',
    'href="styles.css" />\n  <link rel="stylesheet" href="styles-msg.css"'
  );
  fs.writeFileSync(indexPath, html);
  console.log("[ensure-msg-styles] linked styles-msg.css");
} else {
  console.log("[ensure-msg-styles] styles.css link not found; skip");
}
