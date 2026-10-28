"use strict";
/**
 * Ensures server.js uses lib/apify-search (locationQuery fix) and pipeline metrics.
 * Idempotent. Safe to run on every start.
 */
const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "..", "server.js");
let src = fs.readFileSync(serverPath, "utf8");
let changed = false;

if (!src.includes('require("./lib/apify-search")')) {
  const needle = 'const { mountAuthRoutes, requireAuth, requireAuthPage } = require("./lib/auth-routes");';
  if (!src.includes(needle)) {
    console.error("[ensure-apify-fix] auth-routes require not found");
    process.exit(1);
  }
  src = src.replace(
    needle,
    needle + '\nconst apifySearch = require("./lib/apify-search");'
  );
  changed = true;
}

if (src.includes("const searchString = location ? `${query} ${location}` : query")) {
  const start = src.indexOf("async function searchApify");
  const end = src.indexOf("\nfunction filterNoWebsite");
  if (start < 0 || end < 0) {
    console.error("[ensure-apify-fix] searchApify block not found");
    process.exit(1);
  }
  const wrapper =
    "async function searchApify(query, location, limit = 50) {\n" +
    "  return apifySearch.searchApify({\n" +
    "    query,\n" +
    "    location,\n" +
    "    limit,\n" +
    "    token: APIFY_API_TOKEN,\n" +
    "    fetchFn: fetch\n" +
    "  });\n" +
    "}";
  src = src.slice(0, start) + wrapper + src.slice(end);
  changed = true;
}

if (!src.includes("pipeline,") && src.includes("const beforeFilter = places.length;")) {
  const oldBlock =
    "    const beforeFilter = places.length;\n" +
    "    places = dedupeAndMerge(places);\n" +
    "    places = applyFilters(places, onlyNoWebsite, Number(minRating) || 0, Number(minReviews) || 0);\n" +
    "    places = sortByQuality(places);\n" +
    "    const afterFilter = places.length;\n" +
    "    places = places.slice(0, Number(maxResults) || 50);\n" +
    "    const payload = {\n" +
    "      success: true, motor: usedMotor, total: places.length, beforeFilter, afterFilter, partial,\n" +
    "      query: { niche, location, minRating, minReviews, onlyNoWebsite }, results: places\n" +
    "    };\n" +
    "    if (sourceErrors) payload.sourceErrors = sourceErrors;\n" +
    "    if (counts) payload.counts = counts;\n" +
    "    if (partial) payload.message = \"Pesquisa parcial: uma das fontes falhou; a mostrar resultados disponíveis.\";\n" +
    "    res.json(payload);";

  const newBlock =
    "    const sourcePipeline = places && places._pipeline ? { ...places._pipeline } : null;\n" +
    "    if (places && places._pipeline) delete places._pipeline;\n" +
    "    const rawCount = places.length;\n" +
    "    const withWebsiteBefore = places.filter((p) => isOfficialWebsite(p.website)).length;\n" +
    "    const withoutWebsiteBefore = places.length - withWebsiteBefore;\n" +
    "    places = dedupeAndMerge(places);\n" +
    "    const afterDedupe = places.length;\n" +
    "    const dedupeRemoved = Math.max(0, rawCount - afterDedupe);\n" +
    "    const afterOnlyNoWebsite = onlyNoWebsite ? filterNoWebsite(places).length : afterDedupe;\n" +
    "    places = applyFilters(places, onlyNoWebsite, Number(minRating) || 0, Number(minReviews) || 0);\n" +
    "    const afterFilter = places.length;\n" +
    "    places = sortByQuality(places);\n" +
    "    places = places.slice(0, Number(maxResults) || 50);\n" +
    "    const pipeline = {\n" +
    "      requestedMax: Number(maxResults) || 50,\n" +
    "      fetchLimit,\n" +
    "      sourceRaw: sourcePipeline ? sourcePipeline.apifyRaw : rawCount,\n" +
    "      sourceNormalized: sourcePipeline ? sourcePipeline.normalized : rawCount,\n" +
    "      sourceDroppedNoName: sourcePipeline ? sourcePipeline.droppedNoName : 0,\n" +
    "      sourceWithWebsite: sourcePipeline ? sourcePipeline.withWebsite : withWebsiteBefore,\n" +
    "      sourceWithoutWebsite: sourcePipeline ? sourcePipeline.withoutWebsite : withoutWebsiteBefore,\n" +
    "      afterDedupe,\n" +
    "      dedupeRemoved,\n" +
    "      afterOnlyNoWebsite,\n" +
    "      afterQualityFilters: afterFilter,\n" +
    "      returned: places.length,\n" +
    "      apifyStatus: sourcePipeline ? sourcePipeline.apifyStatus : null,\n" +
    "      apifyInput: sourcePipeline ? sourcePipeline.input : null,\n" +
    "      completed: true\n" +
    "    };\n" +
    "    const payload = {\n" +
    "      success: true, motor: usedMotor, total: places.length, beforeFilter: rawCount, afterFilter, partial, pipeline,\n" +
    "      query: { niche, location, minRating, minReviews, onlyNoWebsite }, results: places\n" +
    "    };\n" +
    "    if (sourceErrors) payload.sourceErrors = sourceErrors;\n" +
    "    if (counts) payload.counts = counts;\n" +
    "    if (partial) payload.message = \"Pesquisa parcial: uma das fontes falhou; a mostrar resultados disponíveis.\";\n" +
    "    res.json(payload);";

  if (!src.includes(oldBlock)) {
    console.error("[ensure-apify-fix] route block not found exactly");
    process.exit(1);
  }
  src = src.replace(oldBlock, newBlock);
  changed = true;
}

if (src.includes('version: "6.3.1"')) {
  src = src.replace('version: "6.3.1"', 'version: "6.3.2"');
  changed = true;
}

if (changed) {
  fs.writeFileSync(serverPath, src);
  console.log("[ensure-apify-fix] server.js updated");
} else {
  console.log("[ensure-apify-fix] already applied");
}
