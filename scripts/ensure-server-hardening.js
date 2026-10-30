"use strict";
/**
 * Idempotent runtime patches for server.js:
 * - Cache-Control no-cache for JS/CSS
 * - Delegate searchOpenStreetMap to lib/osm-search.js (per-endpoint AbortController)
 * - hasOsm reflects configuration (not always true)
 * - unhandledRejection logs; uncaughtException logs full stack and exits (supervisor restart)
 * - Clearer /api/status version + osmConfigured / apifyConfigured
 *
 * Critical process-handler patch: if expected handlers cannot be applied when missing,
 * exit non-zero so bootstrap does not start an unhardened server.
 */
const fs = require("fs");
const path = require("path");
const serverPath = path.join(__dirname, "..", "server.js");
let src = fs.readFileSync(serverPath, "utf8");
let changed = false;
let criticalFailed = false;

if (!src.includes("setHeaders") && src.includes("express.static")) {
  const oldStatic =
    "app.use(\n" +
    "  express.static(path.join(__dirname), {\n" +
    "    index: false\n" +
    "  })\n" +
    ");";
  const newStatic =
    "app.use(\n" +
    "  express.static(path.join(__dirname), {\n" +
    "    index: false,\n" +
    "    setHeaders: function (res, filePath) {\n" +
    "      if (/\\.(js|css)$/i.test(filePath)) {\n" +
    "        res.setHeader(\"Cache-Control\", \"no-cache, must-revalidate\");\n" +
    "      }\n" +
    "    }\n" +
    "  })\n" +
    ");";
  if (src.includes(oldStatic)) {
    src = src.replace(oldStatic, newStatic);
    changed = true;
  }
}

if (!src.includes('require("./lib/osm-search")') && !src.includes("require('./lib/osm-search')")) {
  const needleAuth =
    'const { mountAuthRoutes, requireAuth, requireAuthPage } = require("./lib/auth-routes");';
  if (src.includes(needleAuth)) {
    src = src.replace(
      needleAuth,
      needleAuth + '\nconst osmSearch = require("./lib/osm-search");'
    );
    changed = true;
  }
  const start = src.indexOf("async function searchOpenStreetMap");
  const end = src.indexOf("\nasync function searchApify", start);
  if (start >= 0 && end > start) {
    const wrapper =
      "async function searchOpenStreetMap(niche, location, limit = 50) {\n" +
      "  return osmSearch.searchOpenStreetMap({\n" +
      "    niche,\n" +
      "    location,\n" +
      "    limit,\n" +
      "    endpoints: OVERPASS_ENDPOINTS,\n" +
      "    geocodeLocation,\n" +
      "    buildOverpassQuery,\n" +
      "    normalizeOsmElement,\n" +
      "    fetchFn: fetch,\n" +
      "    timeoutMs: 25000\n" +
      "  });\n" +
      "}\n";
    src = src.slice(0, start) + wrapper + src.slice(end);
    changed = true;
  }
}

if (src.includes("function hasOsm() {\n  return true;\n}")) {
  src = src.replace(
    "function hasOsm() {\n  return true;\n}",
    "function hasOsm() {\n  return Array.isArray(OVERPASS_ENDPOINTS) && OVERPASS_ENDPOINTS.length > 0;\n}"
  );
  changed = true;
}

const SAFE_HANDLERS =
  "process.on(\"unhandledRejection\", function (reason) {\n" +
  "  console.error(\"[process] unhandledRejection:\", reason && reason.stack ? reason.stack : reason);\n" +
  "});\n" +
  "process.on(\"uncaughtException\", function (err) {\n" +
  "  console.error(\"[process] uncaughtException:\", err && err.stack ? err.stack : err);\n" +
  "  // Fatal: do not continue in an unknown state — let the platform supervisor restart\n" +
  "  process.exit(1);\n" +
  "});\n\n";

const DANGEROUS_KEEP_ALIVE =
  "process.on(\"uncaughtException\", function (err) {\n" +
  "  console.error(\"[process] uncaughtException:\", err && err.message ? err.message : err);\n" +
  "  // Do not process.exit — keep Express alive for recoverable faults\n" +
  "});";

if (src.includes("Do not process.exit — keep Express alive")) {
  const blockStart = src.indexOf('process.on("unhandledRejection"');
  const listenNeedle = "app.listen(PORT, () => {";
  const listenIdx = src.indexOf(listenNeedle);
  if (blockStart >= 0 && listenIdx > blockStart) {
    src = src.slice(0, blockStart) + SAFE_HANDLERS + src.slice(listenIdx);
    changed = true;
    console.log("[ensure-server-hardening] replaced keep-alive uncaughtException with exit(1)");
  } else if (src.includes(DANGEROUS_KEEP_ALIVE)) {
    src = src.replace(DANGEROUS_KEEP_ALIVE,
      "process.on(\"uncaughtException\", function (err) {\n" +
      "  console.error(\"[process] uncaughtException:\", err && err.stack ? err.stack : err);\n" +
      "  process.exit(1);\n" +
      "});"
    );
    changed = true;
  }
}

if (!src.includes("unhandledRejection")) {
  const listenNeedle = "app.listen(PORT, () => {";
  if (src.includes(listenNeedle)) {
    src = src.replace(listenNeedle, SAFE_HANDLERS + listenNeedle);
    changed = true;
  } else {
    criticalFailed = true;
    console.error("[ensure-server-hardening] CRITICAL: cannot install process handlers (app.listen not found)");
  }
}

if (src.includes("uncaughtException") && !src.includes("process.exit(1)") && src.includes("unhandledRejection")) {
  if (src.includes("Do not process.exit")) {
    criticalFailed = true;
    console.error("[ensure-server-hardening] CRITICAL: uncaughtException still keeps process alive");
  }
}

if (src.includes('version: "6.3.1", message: "ready"')) {
  src = src.replace(
    'version: "6.3.1", message: "ready"',
    'version: "6.5.1", osmConfigured: osm, apifyConfigured: apify, message: "ready"'
  );
  changed = true;
} else if (src.includes('version: "6.3.2", message: "ready"')) {
  src = src.replace(
    'version: "6.3.2", message: "ready"',
    'version: "6.5.1", osmConfigured: osm, apifyConfigured: apify, message: "ready"'
  );
  changed = true;
} else if (src.includes('version: "6.4.1"') && !src.includes("osmConfigured")) {
  src = src.replace(
    /version:\s*"6\.4\.1"[^}]*/,
    'version: "6.5.1", osmConfigured: osm, apifyConfigured: apify, message: "ready"'
  );
  changed = true;
} else if (src.includes('version: "6.5.0"') && !src.includes("osmConfigured")) {
  src = src.replace(
    /version:\s*"6\.5\.0"[^}]*/,
    'version: "6.5.1", osmConfigured: osm, apifyConfigured: apify, message: "ready"'
  );
  changed = true;
}

if (criticalFailed) {
  process.exit(1);
}

if (changed) {
  fs.writeFileSync(serverPath, src);
  console.log("[ensure-server-hardening] server.js updated");
} else {
  console.log("[ensure-server-hardening] already applied");
}
