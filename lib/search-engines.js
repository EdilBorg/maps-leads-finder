"use strict";
module.exports = function createSearchEngines(deps) {
  const { fetch } = deps;
  const {
    APIFY_API_TOKEN,
    OVERPASS_ENDPOINTS,
    hasApify,
    sleep,
    geocodeLocation,
    buildOverpassQuery,
    normalizeOsmElement,
    normalizeApifyPlace,
    isOfficialWebsite,
    dedupeAndMerge,
    applyFilters,
    sortByQuality
  } = deps.place;

  async function searchOpenStreetMap(niche, location, limit = 50) {
    if (!niche || !String(niche).trim()) throw new Error("Nicho em falta para pesquisa OpenStreetMap");
    const bbox = await geocodeLocation(location);
    const query = buildOverpassQuery(niche, bbox, limit);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50000);
    let lastErr = null;
    try {
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
              "User-Agent": "MapsLeadsFinder/1.0"
            },
            body: "data=" + encodeURIComponent(query),
            signal: controller.signal
          });
          if (res.status === 429 || res.status === 504 || res.status === 502) {
            lastErr = new Error(`Overpass rate limit/timeout ${res.status}`);
            continue;
          }
          if (!res.ok) {
            const text = await res.text();
            lastErr = new Error(`Overpass erro ${res.status}: ${text.slice(0, 300)}`);
            continue;
          }
          const data = await res.json();
          const elements = Array.isArray(data.elements) ? data.elements : [];
          const places = [];
          const seen = new Set();
          for (const el of elements) {
            const p = normalizeOsmElement(el);
            if (!p) continue;
            const key = (p.name + "|" + p.address + "|" + p.phone).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            places.push(p);
            if (places.length >= limit) break;
          }
          return places;
        } catch (e) {
          lastErr = e;
          console.log("Overpass endpoint falhou:", endpoint, e.message);
        }
      }
      throw lastErr || new Error("Overpass indisponível");
    } finally {
      clearTimeout(timer);
    }
  }

  async function searchApify(query, location, limit = 50) {
    if (!hasApify()) throw new Error("APIFY_API_TOKEN não configurado. Coloca o token no ficheiro .env");
    const searchString = location ? `${query} ${location}` : query;
    const startRes = await fetch(
      `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${APIFY_API_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchStringsArray: [searchString],
          maxCrawledPlacesPerSearch: limit,
          language: "pt-PT",
          deeperCityScrape: false,
          skipClosedPlaces: true
        })
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
    while ((status === "RUNNING" || status === "READY") && attempts < 60) {
      await sleep(2000);
      const statRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`
      );
      if (!statRes.ok) break;
      const statData = await statRes.json();
      status = statData.data.status;
      attempts += 1;
      if (status === "SUCCEEDED") break;
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new Error(`Apify run terminou com status: ${status}`);
      }
    }
    if (status !== "SUCCEEDED") throw new Error(`Apify timeout ou status: ${status}`);
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_API_TOKEN}&format=json`
    );
    if (!itemsRes.ok) {
      const text = await itemsRes.text();
      throw new Error(`Apify items erro ${itemsRes.status}: ${text}`);
    }
    const items = await itemsRes.json();
    const places = [];
    for (const item of items || []) {
      const p = normalizeApifyPlace(item);
      if (p) places.push(p);
    }
    return places;
  }

  async function searchCombined(niche, location, limit = 50) {
    const errors = {};
    let osmPlaces = [];
    let apifyPlaces = [];
    try {
      osmPlaces = await searchOpenStreetMap(niche, location, limit);
    } catch (e) {
      errors.openstreetmap = e.message;
    }
    if (hasApify()) {
      try {
        apifyPlaces = await searchApify(niche, location, limit);
      } catch (e) {
        errors.apify = e.message;
      }
    }
    let places = osmPlaces.concat(apifyPlaces);
    places = dedupeAndMerge(places);
    const motor =
      osmPlaces.length && apifyPlaces.length
        ? "combined"
        : osmPlaces.length
          ? "openstreetmap"
          : apifyPlaces.length
            ? "apify"
            : "openstreetmap";
    const partial = Object.keys(errors).length > 0 && places.length > 0;
    return {
      places,
      motor,
      partial,
      errors: Object.keys(errors).length ? errors : null,
      counts: { openstreetmap: osmPlaces.length, apify: apifyPlaces.length }
    };
  }

  return { searchOpenStreetMap, searchApify, searchCombined };
};
