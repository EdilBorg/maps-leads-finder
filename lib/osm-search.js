"use strict";

/**
 * Production OpenStreetMap / Overpass search.
 * Single implementation used by server.js — no parallel inline copy.
 *
 * - Independent AbortController per endpoint (never reuse aborted signals)
 * - Configurable per-request timeout (default 20000ms)
 * - Short backoff between endpoints
 * - Classifies HTTP 429/502/503/504, network, DNS, timeout
 * - Valid JSON requires `elements` to be an array (missing key = invalid)
 * - Empty elements array = valid zero results
 */

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_PROBE_TIMEOUT_MS = 4000;
const BACKOFF_BASE_MS = 350;

function classifyNetworkError(e) {
  const code = (e && (e.code || e.errno || e.name)) || "";
  const msg = String((e && e.message) || e || "");
  if (code === "AbortError" || (e && e.name === "AbortError") || /aborted/i.test(msg)) {
    return { kind: "timeout", code: "OSM_TIMEOUT", detail: "timeout/AbortError" };
  }
  if (code === "EAI_AGAIN" || code === "ENOTFOUND" || /getaddrinfo|dns/i.test(msg)) {
    return { kind: "dns", code: "OSM_DNS", detail: code || "DNS" };
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") {
    return { kind: "network", code: "OSM_NETWORK", detail: code };
  }
  return { kind: "network", code: "OSM_NETWORK", detail: code || msg.slice(0, 80) };
}

async function searchOpenStreetMap(opts) {
  const niche = opts.niche;
  const location = opts.location;
  const limit = opts.limit;
  const endpoints = opts.endpoints || [];
  const geocodeLocation = opts.geocodeLocation;
  const buildOverpassQuery = opts.buildOverpassQuery;
  const normalizeOsmElement = opts.normalizeOsmElement;
  const fetchFn = opts.fetchFn || fetch;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  if (!niche || !String(niche).trim()) {
    const err = new Error("Nicho em falta para pesquisa OpenStreetMap");
    err.code = "OSM_INPUT";
    throw err;
  }
  if (!Array.isArray(endpoints) || !endpoints.length) {
    const err = new Error("Overpass não configurado (sem endpoints)");
    err.code = "OSM_NOT_CONFIGURED";
    throw err;
  }

  const bbox = await geocodeLocation(location);
  const query = buildOverpassQuery(niche, bbox, limit);
  const attempts = [];
  let lastErr = null;

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    if (i > 0) {
      await new Promise(function (r) {
        setTimeout(r, Math.min(BACKOFF_BASE_MS * i, 2000));
      });
    }

    const controller = new AbortController();
    let timer = null;
    const started = Date.now();
    try {
      const timeoutPromise = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          try {
            controller.abort();
          } catch (_) {}
          const e = new Error("Overpass timeout após " + timeoutMs + "ms");
          e.name = "AbortError";
          reject(e);
        }, timeoutMs);
      });

      const res = await Promise.race([
        fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "MapsLeadsFinder/1.0"
          },
          body: "data=" + encodeURIComponent(query),
          signal: controller.signal
        }),
        timeoutPromise
      ]);
      const durationMs = Date.now() - started;

      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(
          "Overpass HTTP " + res.status + " (" + endpoint + ", " + durationMs + "ms)"
        );
        lastErr.code = "OSM_HTTP_" + res.status;
        lastErr.status = res.status;
        attempts.push({ endpoint: endpoint, status: res.status, durationMs: durationMs, ok: false });
        console.warn("[osm] endpoint=" + endpoint + " http=" + res.status + " durationMs=" + durationMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(function () {
          return "";
        });
        lastErr = new Error(
          "Overpass HTTP " + res.status + ": " + String(text).slice(0, 200) + " (" + endpoint + ", " + durationMs + "ms)"
        );
        lastErr.code = "OSM_HTTP_" + res.status;
        lastErr.status = res.status;
        attempts.push({ endpoint: endpoint, status: res.status, durationMs: durationMs, ok: false });
        console.warn("[osm]", lastErr.message);
        continue;
      }

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        lastErr = new Error("Overpass JSON inválido (" + endpoint + ", " + durationMs + "ms)");
        lastErr.code = "OSM_INVALID_JSON";
        attempts.push({ endpoint: endpoint, status: res.status, durationMs: durationMs, ok: false, reason: "invalid_json" });
        console.warn("[osm]", lastErr.message);
        continue;
      }

      if (!data || !Array.isArray(data.elements)) {
        lastErr = new Error("Overpass resposta sem elements[] (" + endpoint + ", " + durationMs + "ms)");
        lastErr.code = "OSM_INVALID_BODY";
        attempts.push({ endpoint: endpoint, status: res.status, durationMs: durationMs, ok: false, reason: "no_elements" });
        console.warn("[osm]", lastErr.message);
        continue;
      }

      const elements = data.elements;
      const places = [];
      const seen = new Set();
      for (let j = 0; j < elements.length; j++) {
        const p = normalizeOsmElement(elements[j]);
        if (!p) continue;
        const key = (p.name + "|" + p.address + "|" + p.phone).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        places.push(p);
        if (places.length >= limit) break;
      }

      attempts.push({
        endpoint: endpoint,
        status: res.status,
        durationMs: durationMs,
        ok: true,
        places: places.length
      });
      console.log(
        "[osm] ok endpoint=" + endpoint + " durationMs=" + durationMs + " places=" + places.length
      );
      return places;
    } catch (e) {
      const durationMs = Date.now() - started;
      const classified = classifyNetworkError(e);
      lastErr = new Error(
        "Overpass " + classified.detail + " (" + endpoint + ", " + durationMs + "ms)"
      );
      lastErr.code = classified.code;
      lastErr.cause = e;
      attempts.push({
        endpoint: endpoint,
        status: null,
        durationMs: durationMs,
        ok: false,
        reason: classified.kind,
        detail: classified.detail
      });
      console.warn(
        "[osm] endpoint=" +
          endpoint +
          " kind=" +
          classified.kind +
          " detail=" +
          classified.detail +
          " durationMs=" +
          durationMs
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const err = lastErr || new Error("Overpass indisponível (todos os endpoints falharam)");
  if (!err.code) err.code = "OSM_UNAVAILABLE";
  err.attempts = attempts;
  throw err;
}

async function probeOverpassAvailability(opts) {
  const endpoints = (opts && opts.endpoints) || [];
  const fetchFn = (opts && opts.fetchFn) || fetch;
  const timeoutMs = (opts && opts.timeoutMs != null) ? opts.timeoutMs : DEFAULT_PROBE_TIMEOUT_MS;
  if (!endpoints.length) {
    return { configured: false, reachable: false, error: "no_endpoints" };
  }
  const probeQuery = "[out:json][timeout:5];node(1);out;";
  const endpoint = endpoints[0];
  const controller = new AbortController();
  let timer = null;
  const started = Date.now();
  const timeoutPromise = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      try {
        controller.abort();
      } catch (_) {}
      const e = new Error("probe timeout");
      e.name = "AbortError";
      reject(e);
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": "MapsLeadsFinder/1.0"
        },
        body: "data=" + encodeURIComponent(probeQuery),
        signal: controller.signal
      }),
      timeoutPromise
    ]);
    const durationMs = Date.now() - started;
    if (!res.ok) {
      return {
        configured: true,
        reachable: false,
        endpoint: endpoint,
        durationMs: durationMs,
        status: res.status,
        error: "http_" + res.status
      };
    }
    return {
      configured: true,
      reachable: true,
      endpoint: endpoint,
      durationMs: durationMs,
      status: res.status
    };
  } catch (e) {
    const classified = classifyNetworkError(e);
    return {
      configured: true,
      reachable: false,
      endpoint: endpoint,
      durationMs: Date.now() - started,
      error: classified.kind,
      detail: classified.detail
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  searchOpenStreetMap,
  probeOverpassAvailability,
  classifyNetworkError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS
};
