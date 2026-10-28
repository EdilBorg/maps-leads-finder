"use strict";
const fs = require("fs");
const path = require("path");
const indexPath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf8");
let changed = false;
const pairs = [
  ['src="history.js"', 'src="history.js?v=6.4.1"'],
  ['src="template.js"', 'src="template.js?v=6.4.1"'],
  ['href="styles.css"', 'href="styles.css?v=6.4.1"'],
  ['href="styles-msg.css"', 'href="styles-msg.css?v=6.4.1"']
];
for (const [a, b] of pairs) {
  if (html.includes(a) && !html.includes(b)) {
    html = html.replace(a, b);
    changed = true;
  }
}
if (changed) {
  fs.writeFileSync(indexPath, html);
  console.log("[ensure-cache-bust] index.html versioned asset URLs");
} else {
  console.log("[ensure-cache-bust] already applied");
}
