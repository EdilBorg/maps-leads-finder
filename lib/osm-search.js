"use strict";

/**
 * OpenStreetMap / Overpass search used by production server.js.
 * Each endpoint gets its own AbortController + timeout so one abort
 * does not poison the remaining fallback endpoints.
 */

async function searchOpenStreetMap(opts) {
  const niche = opts.niche;
  const location = opts.location;
  const limit = opts.limit;
  const endpoints = opts.endpoints || [];
  const geocodeLocation = opts.geocodeLocation;
  const buildOverpassQuery = opts.buildOverpassQuery;
  const normalizeOsmElement = opts.normalizeOsmElement;
  const fetchFn = opts.fetchFn || fetch;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 25000;

  if (!niche || !String(niche).trim()) {
    throw new Error("Nicho em falta para pesquisa OpenStreetMap");
  }
  if (!Array.isArray(endpoints) || !endpoints.length) {
    throw new Error("Overpass indisponível");
  }

  const bbox = await geocodeLocation(location);
  const query = buildOverpassQuery(niche, bbox, limit);
  let lastErr = null;

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetchFn(endpoint, {
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
        lastErr = new Error(
          "Overpass rate limit/timeout " + res.status + " (" + endpoint + ")"
        );
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        lastErr = new Error(
          "Overpass erro " + res.status + ": " + String(text).slice(0, 300)
        );
        continue;
      }
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        lastErr = new Error("Overpass JSON inválido (" + endpoint + ")");
        continue;
      }
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
      const msg =
        e && e.name === "AbortError"
          ? "Overpass timeout (" + endpoint + ")"
          : e && e.message
            ? e.message
            : String(e);
      lastErr = new Error(msg);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Overpass indisponível");
}

module.exports = { searchOpenStreetMap };
