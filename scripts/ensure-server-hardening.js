"use strict";
/**
 * Idempotent runtime patches for server.js:
 * - Cache-Control no-cache for JS/CSS
 * - Per-endpoint AbortController in searchOpenStreetMap
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

const oldCtrl =
  "  const controller = new AbortController();\n" +
  "  const timer = setTimeout(() => controller.abort(), 50000);\n" +
  "  let lastErr = null;\n" +
  "  try {\n" +
  "    for (const endpoint of OVERPASS_ENDPOINTS) {\n";
if (src.includes(oldCtrl)) {
  const start = src.indexOf("async function searchOpenStreetMap");
  const end = src.indexOf("\nasync function searchApify", start);
  if (start >= 0 && end > start) {
    const newFn =
      "async function searchOpenStreetMap(niche, location, limit = 50) {\n" +
      "  if (!niche || !String(niche).trim()) throw new Error(\"Nicho em falta para pesquisa OpenStreetMap\");\n" +
      "  const bbox = await geocodeLocation(location);\n" +
      "  const query = buildOverpassQuery(niche, bbox, limit);\n" +
      "  let lastErr = null;\n" +
      "  for (const endpoint of OVERPASS_ENDPOINTS) {\n" +
      "    const controller = new AbortController();\n" +
      "    const timer = setTimeout(() => controller.abort(), 25000);\n" +
      "    try {\n" +
      "      const res = await fetch(endpoint, {\n" +
      "        method: \"POST\",\n" +
      "        headers: {\n" +
      "          \"Content-Type\": \"application/x-www-form-urlencoded\",\n" +
      "          Accept: \"application/json\",\n" +
      "          \"User-Agent\": \"MapsLeadsFinder/1.0\"\n" +
      "        },\n" +
      "        body: \"data=\" + encodeURIComponent(query),\n" +
      "        signal: controller.signal\n" +
      "      });\n" +
      "      if (res.status === 429 || res.status === 504 || res.status === 502) {\n" +
      "        lastErr = new Error(\"Overpass rate limit/timeout \" + res.status + \" (\" + endpoint + \")\");\n" +
      "        continue;\n" +
      "      }\n" +
      "      if (!res.ok) {\n" +
      "        const text = await res.text();\n" +
      "        lastErr = new Error(\"Overpass erro \" + res.status + \": \" + text.slice(0, 300));\n" +
      "        continue;\n" +
      "      }\n" +
      "      let data;\n" +
      "      try {\n" +
      "        data = await res.json();\n" +
      "      } catch (parseErr) {\n" +
      "        lastErr = new Error(\"Overpass JSON inválido (\" + endpoint + \")\");\n" +
      "        continue;\n" +
      "      }\n" +
      "      const elements = Array.isArray(data.elements) ? data.elements : [];\n" +
      "      const places = [];\n" +
      "      const seen = new Set();\n" +
      "      for (const el of elements) {\n" +
      "        const p = normalizeOsmElement(el);\n" +
      "        if (!p) continue;\n" +
      "        const key = (p.name + \"|\" + p.address + \"|\" + p.phone).toLowerCase();\n" +
      "        if (seen.has(key)) continue;\n" +
      "        seen.add(key);\n" +
      "        places.push(p);\n" +
      "        if (places.length >= limit) break;\n" +
      "      }\n" +
      "      return places;\n" +
      "    } catch (e) {\n" +
      "      const msg = (e && e.name === \"AbortError\")\n" +
      "        ? (\"Overpass timeout (\" + endpoint + \")\")\n" +
      "        : ((e && e.message) ? e.message : String(e));\n" +
      "      lastErr = new Error(msg);\n" +
      "      console.log(\"Overpass endpoint falhou:\", endpoint, msg);\n" +
      "    } finally {\n" +
      "      clearTimeout(timer);\n" +
      "    }\n" +
      "  }\n" +
      "  throw lastErr || new Error(\"Overpass indisponível\");\n" +
      "}\n";
    src = src.slice(0, start) + newFn + src.slice(end);
    changed = true;
  }
}

if (!src.includes("osmConfigured") && src.includes('app.get("/api/status"')) {
  src = src.replace(
    'version: "6.3.1", message: "ready"',
    'version: "6.4.1", osmConfigured: osm, message: "ready"'
  );
  src = src.replace(
    'version: "6.3.2", message: "ready"',
    'version: "6.4.1", osmConfigured: osm, message: "ready"'
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(serverPath, src);
  console.log("[ensure-server-hardening] server.js updated");
} else {
  console.log("[ensure-server-hardening] already applied");
}
