"use strict";
/**
 * Production entry: apply Apify volume + pipeline UI fixes, then start the app.
 * Hosts should run: node bootstrap.js  (or npm start)
 */
try {
  require("./scripts/ensure-apify-fix.js");
} catch (e) {
  console.warn("[bootstrap] ensure-apify-fix:", e && e.message ? e.message : e);
}
try {
  require("./scripts/ensure-index-fix.js");
} catch (e) {
  console.warn("[bootstrap] ensure-index-fix:", e && e.message ? e.message : e);
}
require("./server.js");
