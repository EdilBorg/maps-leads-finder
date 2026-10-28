"use strict";
/**
 * Idempotent runtime patches for server.js:
 * - Cache-Control no-cache for JS/CSS
 * - Delegate searchOpenStreetMap to lib/osm-search.js (per-endpoint AbortController)
 * - Clearer /api/status version field
 */
const fs = require("fs");
const path = require("path");
const serverPath = path.join(__dirname, "..", "server.js");
let src = fs.readFileSync(serverPath, "utf8");
let changed = false;

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

if (!src.includes("osmConfigured") && src.includes('app.get("/api/status"')) {
  if (src.includes('version: "6.3.1", message: "ready"')) {
    src = src.replace(
      'version: "6.3.1", message: "ready"',
      'version: "6.4.1", osmConfigured: osm, message: "ready"'
    );
    changed = true;
  } else if (src.includes('version: "6.3.2", message: "ready"')) {
    src = src.replace(
      'version: "6.3.2", message: "ready"',
      'version: "6.4.1", osmConfigured: osm, message: "ready"'
    );
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(serverPath, src);
  console.log("[ensure-server-hardening] server.js updated");
} else {
  console.log("[ensure-server-hardening] already applied");
}
