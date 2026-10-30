"use strict";
/**
 * Apify Google Places search with correct locationQuery + pipeline stats.
 * Used by server.js searchApify.
 *
 * HTTP timeouts (AbortController + Promise.race, cleaned in finally):
 *   START_TIMEOUT_MS   — create actor run (default 30000)
 *   POLL_TIMEOUT_MS    — each status poll (default 20000)
 *   DATASET_TIMEOUT_MS — dataset items fetch (default 45000)
 * Plus maxTotalMs overall polling budget.
 */

/** @type {number} create-run HTTP timeout (ms) */
const START_TIMEOUT_MS = 30000;
/** @type {number} each polling HTTP timeout (ms) */
const POLL_TIMEOUT_MS = 20000;
/** @type {number} dataset items HTTP timeout (ms) */
const DATASET_TIMEOUT_MS = 45000;

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

async function fetchWithTimeout(fetchFn, url, init, timeoutMs, label) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  const timeoutPromise = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      if (controller) {
        try { controller.abort(); } catch (_) {}
      }
      const err = new Error("Apify " + label + " timeout após " + timeoutMs + "ms");
      err.code = "APIFY_TIMEOUT";
      reject(err);
    }, timeoutMs);
  });
  try {
    const opts = Object.assign({}, init || {});
    if (controller) opts.signal = controller.signal;
    return await Promise.race([fetchFn(url, opts), timeoutPromise]);
  } catch (e) {
    if (e && e.code === "APIFY_TIMEOUT") throw e;
    const code = (e && (e.code || e.errno || e.name)) || "";
    if (code === "AbortError" || (e && e.name === "AbortError")) {
      const err = new Error("Apify " + label + " timeout após " + timeoutMs + "ms");
      err.code = "APIFY_TIMEOUT";
      throw err;
    }
    const err = new Error("Apify " + label + " rede: " + (e && e.message ? e.message : String(e)));
    err.code = "APIFY_NETWORK";
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyHttpError(status, text, context) {
  const slice = String(text || "").slice(0, 200);
  if (status === 429) {
    const err = new Error("Apify " + context + " HTTP 429 (rate limit): " + slice);
    err.code = "APIFY_RATE_LIMIT";
    err.status = 429;
    return err;
  }
  if (status === 401 || status === 403) {
    const err = new Error("Apify autenticação inválida (HTTP " + status + ")");
    err.code = "APIFY_AUTH";
    err.status = status;
    return err;
  }
  if (status >= 500) {
    const err = new Error("Apify " + context + " HTTP " + status + ": " + slice);
    err.code = "APIFY_SERVER";
    err.status = status;
    return err;
  }
  const err = new Error("Apify " + context + " HTTP " + status + ": " + slice);
  err.code = "APIFY_HTTP";
  err.status = status;
  return err;
}

async function searchApify(opts) {
  const fetchFn = opts.fetchFn || fetch;
  const token = opts.token || "";
  if (!token || String(token).includes("colocar_")) {
    throw new Error("APIFY_API_TOKEN não configurado. Coloca o token no ficheiro .env");
  }
  const niche = String(opts.query || "").trim();
  const loc = String(opts.location || "").trim();
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const startTimeoutMs = opts.startTimeoutMs != null ? opts.startTimeoutMs : START_TIMEOUT_MS;
  const pollTimeoutMs = opts.pollTimeoutMs != null ? opts.pollTimeoutMs : POLL_TIMEOUT_MS;
  const datasetTimeoutMs = opts.datasetTimeoutMs != null ? opts.datasetTimeoutMs : DATASET_TIMEOUT_MS;

  const input = {
    searchStringsArray: [niche || loc || "business"],
    maxCrawledPlacesPerSearch: limit,
    language: "pt-PT",
    skipClosedPlaces: true,
    deeperCityScrape: limit >= 40
  };
  if (loc) input.locationQuery = loc;

  const startRes = await fetchWithTimeout(
    fetchFn,
    "https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=" + token,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    startTimeoutMs,
    "start"
  );
  if (!startRes.ok) {
    const text = await startRes.text().catch(function () { return ""; });
    throw classifyHttpError(startRes.status, text, "start");
  }
  let runData;
  try { runData = await startRes.json(); } catch (parseErr) { throw new Error("Apify start: JSON inválido"); }
  if (!runData || !runData.data) throw new Error("Apify start: estrutura inesperada");
  const runId = runData.data.id;
  const defaultDatasetId = runData.data.defaultDatasetId;
  if (!runId || !defaultDatasetId) throw new Error("Apify start: resposta sem runId ou defaultDatasetId");

  let status = "RUNNING";
  let attempts = 0;
  const maxAttempts = limit >= 100 ? 120 : limit >= 40 ? 90 : 60;
  const pollStart = Date.now();
  const maxTotalMs = Math.min(maxAttempts * 2500, 5 * 60 * 1000);
  while ((status === "RUNNING" || status === "READY") && attempts < maxAttempts) {
    if (Date.now() - pollStart > maxTotalMs) {
      throw new Error("Apify timeout total de polling (" + Math.round(maxTotalMs / 1000) + "s)");
    }
    await sleep(Math.min(2000 + attempts * 200, 8000));
    const statusRes = await fetchWithTimeout(
      fetchFn,
      "https://api.apify.com/v2/actor-runs/" + runId + "?token=" + token,
      { method: "GET" },
      pollTimeoutMs,
      "polling"
    );
    if (!statusRes.ok) {
      const text = await statusRes.text().catch(function () { return ""; });
      throw classifyHttpError(statusRes.status, text, "polling");
    }
    let statusData;
    try { statusData = await statusRes.json(); } catch (parseErr) { throw new Error("Apify status JSON inválido"); }
    if (!statusData || !statusData.data || typeof statusData.data.status !== "string") {
      throw new Error("Apify status: estrutura inesperada");
    }
    status = statusData.data.status;
    attempts++;
  }
  if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
    throw new Error("Apify run terminou com status: " + status);
  }
  if (status !== "SUCCEEDED") {
    throw new Error("Apify run terminou com status: " + status + " (após " + attempts + " polls)");
  }

  const datasetRes = await fetchWithTimeout(
    fetchFn,
    "https://api.apify.com/v2/datasets/" + defaultDatasetId + "/items?token=" + token + "&format=json&limit=" + limit,
    { method: "GET" },
    datasetTimeoutMs,
    "dataset"
  );
  if (!datasetRes.ok) {
    const text = await datasetRes.text().catch(function () { return ""; });
    throw classifyHttpError(datasetRes.status, text, "dataset");
  }
  let raw;
  try { raw = await datasetRes.json(); } catch (parseErr) { throw new Error("Apify dataset JSON inválido"); }
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
      deeperCityScrape: input.deeperCityScrape,
      language: input.language
    }
  };
  const places = [];
  for (const item of raw || []) {
    const p = normalizeApifyPlace(item);
    if (!p) { stats.droppedNoName += 1; continue; }
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
  isOfficialWebsite,
  fetchWithTimeout,
  classifyHttpError,
  START_TIMEOUT_MS,
  POLL_TIMEOUT_MS,
  DATASET_TIMEOUT_MS
};
