"use strict";

/**
 * OpenStreetMap / Overpass search used by production server.js.
 * Each endpoint gets its own AbortController + timeout so one abort
 * does not poison the remaining fallback endpoints.
 * Default client timeout 35000ms; Overpass query uses [timeout:30].
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
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 35000;

  if (!niche || !String(niche).trim()) {
    throw new Error("Nicho em falta para pesquisa OpenStreetMap");
  }
  if (!Array.isArray(endpoints) || !endpoints.length) {
    throw new Error("Overpass indisponível");
  }

  const bbox = await geocodeLocation(location);
  const query = buildOverpassQuery(niche, bbox, limit);
  let lastErr = null;

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    if (i > 0) {
      await new Promise(function (r) {
        setTimeout(r, Math.min(400 * i, 2000));
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    const started = Date.now();
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
      const durationMs = Date.now() - started;
      if (res.status === 429 || res.status === 503 || res.status === 504 || res.status === 502) {
        lastErr = new Error(
          "Overpass HTTP " + res.status + " (" + endpoint + ", " + durationMs + "ms)"
        );
        console.warn("[osm]", lastErr.message);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(function () {
          return "";
        });
        lastErr = new Error(
          "Overpass erro " + res.status + ": " + String(text).slice(0, 300) + " (" + endpoint + ")"
        );
        console.warn("[osm]", lastErr.message);
        continue;
      }
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        lastErr = new Error("Overpass JSON inválido (" + endpoint + ")");
        console.warn("[osm]", lastErr.message);
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
      console.log(
        "[osm] ok endpoint=" + endpoint + " durationMs=" + durationMs + " places=" + places.length
      );
      return places;
    } catch (e) {
      const code = (e && (e.code || e.errno || e.name)) || "";
      const isNet =
        code === "EAI_AGAIN" ||
        code === "ENOTFOUND" ||
        code === "ECONNREFUSED" ||
        code === "ETIMEDOUT" ||
        code === "AbortError" ||
        (e && e.name === "AbortError");
      lastErr = e;
      console.warn(
        "[osm] Overpass network/timeout " +
          (code || (e && e.message) || "error") +
          " (" +
          endpoint +
          ")"
      );
      if (!isNet && !lastErr) lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("Overpass indisponível");
}

module.exports = {
  searchOpenStreetMap
};
