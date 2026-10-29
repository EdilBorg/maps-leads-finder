"use strict";
const fs = require("fs");
const path = require("path");
const indexPath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf8");
let changed = false;
const VER = "6.4.2";
const pairs = [
  ['src="history.js"', 'src="history.js?v=' + VER + '"'],
  ['src="template.js"', 'src="template.js?v=' + VER + '"'],
  ['href="styles.css"', 'href="styles.css?v=' + VER + '"'],
  ['href="styles-msg.css"', 'href="styles-msg.css?v=' + VER + '"']
];
// Also bump existing ?v= versions
html2 = html;
for (const name of ["history.js", "template.js", "styles.css", "styles-msg.css"]) {
  const re = new RegExp(name.replace(".", "\\.") + "\\?v=[^\"']+", "g");
  const next = name + "?v=" + VER;
  if (re.test(html2)) {
    html2 = html2.replace(re, next);
    changed = true;
  }
}
html = html2;
for (const [a, b] of pairs) {
  if (html.includes(a) && !html.includes(b)) {
    html = html.replace(a, b);
    changed = true;
  }
}
if (changed) {
  fs.writeFileSync(indexPath, html);
  console.log("[ensure-cache-bust] index.html versioned asset URLs " + VER);
} else {
  console.log("[ensure-cache-bust] already applied");
}
