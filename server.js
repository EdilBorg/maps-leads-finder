/**
 * Maps Leads Finder - Backend
 * Motores: OpenStreetMap (Overpass) + Apify
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || "";
const OVERPASS_URL = process.env.OVERPASS_URL || "";
const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = OVERPASS_URL
  ? [OVERPASS_URL]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://lz4.overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter"
    ];

function hasApify() {
  return !!(APIFY_API_TOKEN && !APIFY_API_TOKEN.includes("colocar_"));
}

function hasOsm() {
  return true;
}

function friendlyError(err, motor) {
  const raw = (err && err.message) ? String(err.message) : String(err);
  const lower = raw.toLowerCase();
  console.error("[search error]", motor || "-", raw.slice(0, 500));

  if (lower.includes("não configurada") || lower.includes("não configurado") || lower.includes("colocar_")) {
    return { code: "NO_API_KEY", error: "O serviço de pesquisa não está disponível de momento. Tenta novamente mais tarde.", hint: null };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api") || lower.includes("authentication")) {
    return { code: "INVALID_KEY", error: "Não foi possível autenticar o serviço de pesquisa. Tenta novamente mais tarde.", hint: null };
  }
  if (lower.includes("402") || lower.includes("payment") || lower.includes("quota") || lower.includes("limit exceeded") || lower.includes("insufficient")) {
    return { code: "QUOTA", error: "O limite de pesquisas foi atingido. Tenta novamente mais tarde ou reduz o número de resultados.", hint: null };
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many") || lower.includes("bandwidth")) {
    return { code: "RATE_LIMIT", error: "Demasiados pedidos em pouco tempo. Espera um minuto e tenta de novo.", hint: null };
  }
  if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("timed out") || lower.includes("gateway timeout")) {
    return { code: "TIMEOUT", error: "A pesquisa demorou demasiado. Reduz o máximo de resultados ou escolhe uma zona mais pequena.", hint: null };
  }
  if (lower.includes("network") || lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("enotfound")) {
    return { code: "NETWORK", error: "Não foi possível ligar ao serviço de pesquisa. Verifica a ligação e tenta de novo.", hint: null };
  }
  if (lower.includes("status: failed") || lower.includes("terminou com status") || lower.includes("sem resultados de localização")) {
    return { code: "RUN_FAILED", error: "Não foi possível concluir a pesquisa. Tenta novamente ou escolhe outra localização.", hint: null };
  }
  return { code: "UNKNOWN", error: "Não foi possível concluir a pesquisa. Tenta novamente.", hint: null };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractCity(address) {
  if (!address) return "";
  const parts = address.split(",");
  return parts.length > 1 ? parts[parts.length - 2].trim() : "";
}

function escapeOverpassRegex(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function osmTagClauses(niche) {
  const n = (niche || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const tags = [];
  const map = [
    [/cabeleireir|barbeari|hair/, ['["shop"="hairdresser"]', '["craft"="hairdresser"]', '["shop"="beauty"]']],
    [/restaurante|restaurant/, ['["amenity"="restaurant"]']],
    [/cafe|cafeteria|pastelaria/, ['["amenity"="cafe"]', '["shop"="bakery"]']],
    [/oficina|mecanico|auto\s*repair|carro/, ['["shop"="car_repair"]', '["shop"="car"]']],
    [/farmacia/, ['["amenity"="pharmacy"]']],
    [/hotel|alojamento|hostel/, ['["tourism"="hotel"]', '["tourism"="hostel"]', '["tourism"="guest_house"]']],
    [/ginasio|gym|fitness/, ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]']],
    [/dentista|dental/, ['["amenity"="dentist"]']],
    [/advogad|juridic|lawyer/, ['["office"="lawyer"]']],
    [/contabil|accountant/, ['["office"="accountant"]']],
    [/veterinar/, ['["amenity"="veterinary"]']],
    [/padaria|bakery/, ['["shop"="bakery"]']],
    [/supermercado|mercearia/, ['["shop"="supermarket"]', '["shop"="convenience"]']],
    [/florista|flor/, ['["shop"="florist"]']],
    [/roupa|boutique|vestuario/, ['["shop"="clothes"]']],
    [/eletronic|telemovel|phone/, ['["shop"="electronics"]', '["shop"="mobile_phone"]']],
    [/escola|academy|formacao/, ['["amenity"="school"]', '["amenity"="college"]']],
    [/clinica|medico|saude/, ['["amenity"="clinic"]', '["amenity"="doctors"]']],
  ];
  for (const [re, list] of map) {
    if (re.test(n)) tags.push(...list);
  }
  return [...new Set(tags)];
}

async function geocodeLocation(location) {
  const q = (location || "").trim() || "Portugal";
  const url = NOMINATIM_URL + "?format=json&limit=1&addressdetails=0&q=" + encodeURIComponent(q);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "MapsLeadsFinder/1.0 (local research tool)",
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Nominatim erro ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      throw new Error("Sem resultados de localização para: " + q);
    }
    const item = data[0];
    const bb = item.boundingbox;
    if (!bb || bb.length < 4) {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const d = 0.08;
      return { south: lat - d, north: lat + d, west: lon - d, east: lon + d, display: item.display_name || q };
    }
    return {
      south: parseFloat(bb[0]),
      north: parseFloat(bb[1]),
      west: parseFloat(bb[2]),
      east: parseFloat(bb[3]),
      display: item.display_name || q
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildOverpassQuery(niche, bbox, limit) {
  const { south, north, west, east } = bbox;
  const bboxStr = `${south},${west},${north},${east}`;
  const nameRe = escapeOverpassRegex(niche.trim());
  const tagClauses = osmTagClauses(niche);
  const parts = [];
  parts.push(`nwr["name"~"${nameRe}",i](${bboxStr});`);
  for (const t of tagClauses) {
    parts.push(`nwr${t}(${bboxStr});`);
  }
  if (!tagClauses.length && niche.trim()) {
    parts.push(`nwr["shop"]["name"~"${nameRe}",i](${bboxStr});`);
    parts.push(`nwr["amenity"]["name"~"${nameRe}",i](${bboxStr});`);
    parts.push(`nwr["craft"]["name"~"${nameRe}",i](${bboxStr});`);
    parts.push(`nwr["office"]["name"~"${nameRe}",i](${bboxStr});`);
    parts.push(`nwr["tourism"]["name"~"${nameRe}",i](${bboxStr});`);
  }
  const outLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return `[out:json][timeout:45];\n(\n  ${parts.join("\n  ")}\n);\nout center ${outLimit};`;
}

function osmWebsite(tags) {
  if (!tags) return "";
  const candidates = [tags.website, tags["contact:website"], tags.url, tags["contact:url"], tags["website:pt"]];
  for (const c of candidates) {
    if (c && String(c).trim()) {
      const v = String(c).trim();
      if (/google\.(com|pt).*maps|maps\.google|openstreetmap\.org|osm\.org/i.test(v)) continue;
      return v;
    }
  }
  return "";
}

function osmPhone(tags) {
  if (!tags) return "";
  return (tags.phone || tags["contact:phone"] || tags["contact:mobile"] || tags.mobile || "").trim();
}

function osmAddress(tags) {
  if (!tags) return "";
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const parts = [street, tags["addr:city"] || tags["addr:place"] || tags["addr:suburb"], tags["addr:postcode"]].filter(Boolean);
  return parts.join(", ");
}

function normalizeOsmElement(el) {
  const tags = el.tags || {};
  const lat = el.lat || (el.center && el.center.lat) || null;
  const lon = el.lon || (el.center && el.center.lon) || null;
  const name = tags.name || tags["name:pt"] || tags.brand || "";
  if (!name) return null;
  const address = osmAddress(tags);
  const city = tags["addr:city"] || tags["addr:place"] || extractCity(address);
  return {
    name,
    phone: osmPhone(tags),
    address,
    rating: null,
    reviews: 0,
    website: osmWebsite(tags),
    city: city || "",
    place_id: el.type && el.id ? `${el.type}/${el.id}` : "",
    source: "osm",
    lat,
    lon
  };
}

async function searchOpenStreetMap(niche, location, limit = 50) {
  if (!niche || !String(niche).trim()) {
    throw new Error("Nicho em falta para pesquisa OpenStreetMap");
  }
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
  if (!hasApify()) {
    throw new Error("APIFY_API_TOKEN não configurado. Coloca o token no ficheiro .env");
  }
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
  const maxAttempts = 60;
  while ((status === "RUNNING" || status === "READY") && attempts < maxAttempts) {
    await sleep(2000);
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`);
    const statusData = await statusRes.json();
    status = statusData.data.status;
    attempts++;
  }
  if (status !== "SUCCEEDED") {
    throw new Error(`Apify run terminou com status: ${status}`);
  }
  const datasetRes = await fetch(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_API_TOKEN}&format=json&limit=${limit}`
  );
  if (!datasetRes.ok) {
    const text = await datasetRes.text();
    throw new Error(`Apify dataset erro ${datasetRes.status}: ${text}`);
  }
  const places = await datasetRes.json();
  return places.map(p => ({
    name: p.title || p.name || "",
    phone: p.phone || "",
    address: p.address || p.street || "",
    rating: p.totalScore || p.rating || null,
    reviews: p.reviewsCount || p.reviews || 0,
    website: p.website || p.url || "",
    city: p.city || extractCity(p.address || ""),
    place_id: p.placeId || p.place_id || "",
    source: "apify"
  }));
}

function filterNoWebsite(places) {
  return places.filter(p => {
    const site = (p.website || "").trim().toLowerCase();
    return !site || site === "null" || site === "undefined" || site === "-";
  });
}

function filterQuality(places, minRating, minReviews) {
  return places.filter(p => {
    const rating = p.rating == null ? null : Number(p.rating);
    const reviews = Number(p.reviews) || 0;
    if (minRating > 0) {
      if (rating == null) return false;
      if (rating < minRating) return false;
    }
    if (minReviews > 0 && reviews < minReviews) return false;
    return true;
  });
}

function sortByQuality(places) {
  return [...places].sort((a, b) => {
    const reviewsA = Number(a.reviews) || 0;
    const reviewsB = Number(b.reviews) || 0;
    const ratingA = Number(a.rating) || 0;
    const ratingB = Number(b.rating) || 0;
    const scoreA = reviewsA * 10 + ratingA * 100;
    const scoreB = reviewsB * 10 + ratingB * 100;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return reviewsB - reviewsA;
  });
}

function dedupePlaces(places) {
  const seen = new Set();
  const out = [];
  for (const p of places) {
    const key = [
      (p.name || "").toLowerCase().trim(),
      (p.phone || "").replace(/\D/g, ""),
      (p.address || "").toLowerCase().slice(0, 40)
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

async function searchAuto(niche, location, fetchLimit, maxResults) {
  const preferApify = hasApify() && Number(maxResults) >= 100;
  const primary = preferApify ? "apify" : "osm";
  const secondary = preferApify ? "osm" : "apify";
  async function run(motor) {
    if (motor === "apify") {
      if (!hasApify()) throw new Error("APIFY_API_TOKEN não configurado");
      return { places: await searchApify(niche, location, fetchLimit), motor: "apify" };
    }
    return { places: await searchOpenStreetMap(niche, location, fetchLimit), motor: "osm" };
  }
  try {
    return await run(primary);
  } catch (err) {
    console.log(`Fallback ${primary} → ${secondary}:`, err.message);
    if (secondary === "apify" && !hasApify()) throw err;
    return await run(secondary);
  }
}

app.post("/api/search", async (req, res) => {
  let usedMotor = req.body.motor || "auto";
  try {
    const {
      niche = "",
      location = "",
      motor = "auto",
      onlyNoWebsite = true,
      maxResults = 50,
      minRating = 0,
      minReviews = 0
    } = req.body;

    let motorNorm = motor;
    if (motorNorm === "outscraper") motorNorm = "osm";

    if (!niche.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION",
        error: "Escreve o nicho (ex: cabeleireiros, oficinas).",
        hint: null
      });
    }

    let places = [];
    usedMotor = motorNorm;
    const fetchLimit = Math.min(Math.max(Number(maxResults) * 2, Number(maxResults)), 200);

    if (motorNorm === "osm") {
      places = await searchOpenStreetMap(niche, location, fetchLimit);
      usedMotor = "osm";
    } else if (motorNorm === "apify") {
      places = await searchApify(niche, location, fetchLimit);
      usedMotor = "apify";
    } else {
      const result = await searchAuto(niche, location, fetchLimit, maxResults);
      places = result.places;
      usedMotor = result.motor;
    }

    places = dedupePlaces(places);
    if (onlyNoWebsite) places = filterNoWebsite(places);
    places = filterQuality(places, Number(minRating) || 0, Number(minReviews) || 0);
    places = sortByQuality(places);
    places = places.slice(0, Number(maxResults) || 50);

    res.json({
      success: true,
      motor: usedMotor,
      total: places.length,
      query: { niche, location, minRating, minReviews },
      results: places
    });
  } catch (error) {
    console.error("Erro na pesquisa:", error.message);
    const f = friendlyError(error, usedMotor);
    res.status(500).json({
      success: false,
      code: f.code,
      error: f.error,
      hint: f.hint,
      motor: usedMotor
    });
  }
});

app.get("/api/status", (req, res) => {
  const osm = hasOsm();
  const apify = hasApify();
  res.json({
    osm: osm,
    apify: apify,
    outscraper: false,
    ready: osm || apify,
    version: "6.1.0",
    message: "ready"
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`\nMaps Leads Finder em http://localhost:${PORT}`);
  console.log(`   OpenStreetMap: ok`);
  console.log(`   Apify:          ${hasApify() ? "ok" : "off"}\n`);
});
