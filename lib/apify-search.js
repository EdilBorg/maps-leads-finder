"use strict";
/**
 * Apify Google Places search with correct locationQuery + pipeline stats.
 * Used by server.js searchApify.
 */

function isOfficialWebsite(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  if (!v || v === "null" || v === "undefined" || v === "-" || v === "n/a" || v === "none") return false;
  if (/google\.(com|pt).*maps|maps\.google|goo\.gl\/maps|openstreetmap\.org|osm\.org|maps\.app\.goo/i.test(v))
    return false;
  return true;
}

function emptyPlace() {
  return {
    name: "", rating: null, reviews: null, street: "", city: "", state: "", countryCode: "",
    address: "", website: "", phone: "", email: "", categories: [], openingHours: "",
    latitude: null, longitude: null, place_id: "", source: "", sources: []
  };
}

function extractCity(address) {
  if (!address) return "";
  const parts = String(address).split(",");
  return parts.length > 1 ? parts[parts.length - 2].trim() : "";
}

function normalizeApifyPlace(p) {
  if (!p) return null;
  const name = p.title || p.name || "";
  if (!name) return null;
  const websiteRaw = p.website || "";
  const website = isOfficialWebsite(websiteRaw) ? String(websiteRaw).trim() : "";
  let rating = null;
  if (p.totalScore != null && p.totalScore !== "") {
    const n = Number(p.totalScore);
    if (Number.isFinite(n)) rating = n;
  } else if (p.rating != null && p.rating !== "") {
    const n = Number(p.rating);
    if (Number.isFinite(n)) rating = n;
  }
  let reviews = null;
  if (p.reviewsCount != null && p.reviewsCount !== "") {
    const n = Number(p.reviewsCount);
    if (Number.isFinite(n)) reviews = n;
  } else if (p.reviews != null && p.reviews !== "") {
    const n = Number(p.reviews);
    if (Number.isFinite(n)) reviews = n;
  }
  const street = p.street || "";
  const city = p.city || "";
  const state = p.state || "";
  const countryCode = p.countryCode || p.country || "";
  const addressParts = [street, city, state].filter(Boolean);
  const address = addressParts.length ? addressParts.join(", ") : (p.address || "");
  let categories = [];
  if (Array.isArray(p.categories)) categories = p.categories.map(String);
  else if (typeof p.categoryName === "string" && p.categoryName) categories = [p.categoryName];
  const place = emptyPlace();
  place.name = name;
  place.rating = rating;
  place.reviews = reviews;
  place.street = street;
  place.city = city || extractCity(address);
  place.state = state;
  place.countryCode = countryCode;
  place.address = address;
  place.website = website;
  place.phone = (p.phone || "").trim();
  place.email = (p.email || "").trim();
  place.categories = categories;
  place.openingHours = p.openingHours || p.opening_hours || "";
  place.latitude = p.location && p.location.lat != null ? Number(p.location.lat) : (p.lat != null ? Number(p.lat) : null);
  place.longitude = p.location && p.location.lng != null ? Number(p.location.lng) : (p.lng != null ? Number(p.lng) : (p.lon != null ? Number(p.lon) : null));
  place.place_id = p.placeId || p.place_id || "";
  place.source = "apify";
  place.sources = ["apify"];
  return place;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} opts.location
 * @param {number} opts.limit
 * @param {string} opts.token
 * @param {typeof fetch} opts.fetchFn
 */
async function searchApify(opts) {
  const fetchFn = opts.fetchFn || fetch;
  const token = opts.token || "";
  if (!token || String(token).includes("colocar_")) {
    throw new Error("APIFY_API_TOKEN não configurado. Coloca o token no ficheiro .env");
  }
  const niche = String(opts.query || "").trim();
  const loc = String(opts.location || "").trim();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);

  // Official actor input: niche in searchStringsArray, geography in locationQuery.
  const input = {
    searchStringsArray: [niche || loc || "business"],
    maxCrawledPlacesPerSearch: limit,
    language: "pt",
    skipClosedPlaces: true,
    deeperCityScrape: limit >= 40
  };
  if (loc) input.locationQuery = loc;

  const startRes = await fetchFn(
    `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(`Apify start erro ${startRes.status}: ${text}`);
  }
  const runData = await startRes.json();
  const runId = runData.data.id;
  const defaultDatasetId = runData.data.defaultDatasetId;
  let status = "RUNNING";
  let attempts = 0;
  const maxAttempts = limit >= 100 ? 120 : limit >= 40 ? 90 : 60;
  while ((status === "RUNNING" || status === "READY") && attempts < maxAttempts) {
    await sleep(2000);
    const statusRes = await fetchFn(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    const statusData = await statusRes.json();
    status = statusData.data.status;
    attempts++;
  }
  if (status !== "SUCCEEDED") throw new Error(`Apify run terminou com status: ${status}`);

  const datasetRes = await fetchFn(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}&format=json&limit=${limit}`
  );
  if (!datasetRes.ok) {
    const text = await datasetRes.text();
    throw new Error(`Apify dataset erro ${datasetRes.status}: ${text}`);
  }
  const raw = await datasetRes.json();
  const stats = {
    apifyStatus: status,
    apifyRaw: Array.isArray(raw) ? raw.length : 0,
    droppedNoName: 0,
    normalized: 0,
    withWebsite: 0,
    withoutWebsite: 0,
    input: {
      searchStringsArray: input.searchStringsArray,
      locationQuery: input.locationQuery || "",
      maxCrawledPlacesPerSearch: input.maxCrawledPlacesPerSearch,
      deeperCityScrape: input.deeperCityScrape
    }
  };
  const places = [];
  for (const item of raw || []) {
    const p = normalizeApifyPlace(item);
    if (!p) {
      stats.droppedNoName += 1;
      continue;
    }
    stats.normalized += 1;
    if (isOfficialWebsite(p.website)) stats.withWebsite += 1;
    else stats.withoutWebsite += 1;
    places.push(p);
  }
  places._pipeline = stats;
  return places;
}

module.exports = {
  searchApify,
  normalizeApifyPlace,
  isOfficialWebsite
};
