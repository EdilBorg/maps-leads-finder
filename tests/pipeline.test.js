"use strict";
const assert = require("assert");

function isOfficialWebsite(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  if (!v || v === "null" || v === "undefined" || v === "-" || v === "n/a" || v === "none") return false;
  if (/google\.(com|pt).*maps|maps\.google|goo\.gl\/maps|openstreetmap\.org|osm\.org|maps\.app\.goo/i.test(v)) return false;
  return true;
}

function normalizeApifyPlace(p) {
  if (!p) return null;
  const name = p.title || p.name || "";
  if (!name) return null;
  const websiteRaw = p.website || "";
  const website = isOfficialWebsite(websiteRaw) ? String(websiteRaw).trim() : "";
  return { name, website, phone: (p.phone || "").trim(), city: p.city || "", source: "apify", sources: ["apify"] };
}

function filterNoWebsite(places) {
  return places.filter((p) => !isOfficialWebsite(p.website));
}

function buildApifyInput(query, location, limit) {
  const niche = String(query || "").trim();
  const loc = String(location || "").trim();
  const input = {
    searchStringsArray: [niche || loc || "business"],
    maxCrawledPlacesPerSearch: Math.min(Math.max(Number(limit) || 50, 1), 200),
    language: "pt",
    skipClosedPlaces: true,
    deeperCityScrape: Number(limit) >= 40
  };
  if (loc) input.locationQuery = loc;
  return input;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  OK", name); }
  catch (e) { failed++; console.error("  FAIL", name, e.message); }
}

console.log("Apify pipeline unit tests\n");
test("location goes to locationQuery, not search string", () => {
  const input = buildApifyInput("advogado", "Lisboa Portugal", 200);
  assert.deepStrictEqual(input.searchStringsArray, ["advogado"]);
  assert.strictEqual(input.locationQuery, "Lisboa Portugal");
  assert.strictEqual(input.maxCrawledPlacesPerSearch, 200);
  assert.strictEqual(input.deeperCityScrape, true);
});
test("small limit keeps deeperCityScrape false", () => {
  assert.strictEqual(buildApifyInput("cafe", "Porto", 25).deeperCityScrape, false);
});
test("normalize drops items without title/name", () => {
  assert.strictEqual(normalizeApifyPlace({ website: "https://x.com" }), null);
  assert.strictEqual(normalizeApifyPlace({ title: "Escritório A" }).name, "Escritório A");
});
test("maps URL is not official website", () => {
  assert.strictEqual(isOfficialWebsite("https://maps.google.com/?cid=1"), false);
  assert.strictEqual(isOfficialWebsite("https://advogado.pt"), true);
});
test("onlyNoWebsite keeps places without site", () => {
  const places = [
    normalizeApifyPlace({ title: "A", website: "https://a.pt" }),
    normalizeApifyPlace({ title: "B", website: "" }),
    normalizeApifyPlace({ title: "C", website: "https://maps.google.com/place/x" })
  ];
  assert.strictEqual(filterNoWebsite(places).length, 2);
});
console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
