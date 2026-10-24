/**
 * Maps Leads Finder - Backend
 * Motores: OpenStreetMap (Overpass) + Apify
 * Auth: OTP email + sessões seguras
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const session = require("express-session");
const FileStore = require("session-file-store")(session);

const { mountAuthRoutes, requireAuth, requireAuthPage } = require("./lib/auth-routes");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

function validateAuthEnv() {
  const missing = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes("colocar_")) {
    missing.push("SESSION_SECRET");
  }
  if (!process.env.AUTH_EMAIL) missing.push("AUTH_EMAIL");
  if (!process.env.SMTP_USER) missing.push("SMTP_USER");
  if (!process.env.SMTP_PASS || String(process.env.SMTP_PASS).includes("colocar_")) {
    missing.push("SMTP_PASS");
  }
  return missing;
}

const authMissing = validateAuthEnv();
if (authMissing.length) {
  console.warn("[auth] Variáveis em falta ou placeholder:", authMissing.join(", "));
  console.warn("[auth] O login OTP não funcionará até configurar o .env");
}

app.set("trust proxy", 1);
app.use(cors({ origin: false }));
app.use(express.json({ limit: "32kb" }));

app.use(
  session({
    name: "mlf.sid",
    secret: process.env.SESSION_SECRET || "dev-only-change-me-not-for-production",
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
      path: path.join(__dirname, "data", "sessions"),
      ttl: 60 * 60 * 24 * 7,
      retries: 1,
      logFn: function () {}
    }),
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "strict" : "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(
  express.static(path.join(__dirname), {
    index: false,
    extensions: ["css", "js", "map", "png", "svg", "ico", "woff2"]
  })
);

mountAuthRoutes(app);

app.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect("/");
  }
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/login.css", (req, res) => {
  res.sendFile(path.join(__dirname, "login.css"));
});
app.get("/login.js", (req, res) => {
  res.sendFile(path.join(__dirname, "login.js"));
});

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
  const parts = String(address).split(",");
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
      headers: { "User-Agent": "MapsLeadsFinder/1.0 (local research tool)", Accept: "application/json" },
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

function isOfficialWebsite(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  if (!v || v === "null" || v === "undefined" || v === "-" || v === "n/a" || v === "none") return false;
  if (/google\.(com|pt).*maps|maps\.google|goo\.gl\/maps|openstreetmap\.org|osm\.org|maps\.app\.goo/i.test(v)) return false;
  return true;
}

function osmWebsiteFromTags(tags) {
  if (!tags) return "";
  for (const c of [tags.website, tags["contact:website"], tags.url, tags["contact:url"], tags["website:pt"]]) {
    if (isOfficialWebsite(c)) return String(c).trim();
  }
  return "";
}

function osmPhoneFromTags(tags) {
  if (!tags) return "";
  return (tags.phone || tags["contact:phone"] || tags["contact:mobile"] || tags.mobile || "").trim();
}

function osmEmailFromTags(tags) {
  if (!tags) return "";
  return (tags.email || tags["contact:email"] || "").trim();
}

function osmOpeningHours(tags) {
  if (!tags) return "";
  return (tags.opening_hours || tags["contact:opening_hours"] || "").trim();
}

function osmCategories(tags) {
  if (!tags) return [];
  const cats = [];
  if (tags.shop) cats.push("shop:" + tags.shop);
  if (tags.amenity) cats.push("amenity:" + tags.amenity);
  if (tags.office) cats.push("office:" + tags.office);
  if (tags.craft) cats.push("craft:" + tags.craft);
  if (tags.tourism) cats.push("tourism:" + tags.tourism);
  if (tags.leisure) cats.push("leisure:" + tags.leisure);
  return cats;
}

function osmStreet(tags) {
  if (!tags) return "";
  return [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ").trim();
}

function osmFullAddress(tags) {
  if (!tags) return "";
  return [osmStreet(tags), tags["addr:postcode"], tags["addr:city"] || tags["addr:place"] || tags["addr:suburb"]].filter(Boolean).join(", ");
}

function emptyPlace() {
  return {
    name: "", rating: null, reviews: null, street: "", city: "", state: "", countryCode: "",
    address: "", website: "", phone: "", email: "", categories: [], openingHours: "",
    latitude: null, longitude: null, place_id: "", source: "", sources: []
  };
}

function normalizeOsmElement(el) {
  const tags = el.tags || {};
  const lat = el.lat != null ? Number(el.lat) : (el.center && el.center.lat != null ? Number(el.center.lat) : null);
  const lon = el.lon != null ? Number(el.lon) : (el.center && el.center.lon != null ? Number(el.center.lon) : null);
  const name = tags.name || tags["name:pt"] || tags.brand || "";
  if (!name) return null;
  const street = osmStreet(tags);
  const city = tags["addr:city"] || tags["addr:place"] || "";
  const address = osmFullAddress(tags);
  const place = emptyPlace();
  place.name = name;
  place.street = street;
  place.city = city || extractCity(address);
  place.state = tags["addr:state"] || tags["addr:province"] || "";
  place.countryCode = tags["addr:country"] || "";
  place.address = address;
  place.website = osmWebsiteFromTags(tags);
  place.phone = osmPhoneFromTags(tags);
  place.email = osmEmailFromTags(tags);
  place.categories = osmCategories(tags);
  place.openingHours = osmOpeningHours(tags);
  place.latitude = Number.isFinite(lat) ? lat : null;
  place.longitude = Number.isFinite(lon) ? lon : null;
  place.place_id = el.type && el.id ? `${el.type}/${el.id}` : "";
  place.source = "openstreetmap";
  place.sources = ["openstreetmap"];
  return place;
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
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`);
    const statusData = await statusRes.json();
    status = statusData.data.status;
    attempts++;
  }
  if (status !== "SUCCEEDED") throw new Error(`Apify run terminou com status: ${status}`);
  const datasetRes = await fetch(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${APIFY_API_TOKEN}&format=json&limit=${limit}`
  );
  if (!datasetRes.ok) {
    const text = await datasetRes.text();
    throw new Error(`Apify dataset erro ${datasetRes.status}: ${text}`);
  }
  const raw = await datasetRes.json();
  const places = [];
  for (const item of raw) {
    const p = normalizeApifyPlace(item);
    if (p) places.push(p);
  }
  return places;
}

function filterNoWebsite(places) {
  return places.filter(p => !isOfficialWebsite(p.website));
}

function filterQuality(places, minRating, minReviews) {
  const minR = Number(minRating) || 0;
  const minRev = Number(minReviews) || 0;
  if (minR <= 0 && minRev <= 0) return places;
  return places.filter(p => {
    const isOsmOnly =
      (p.source === "openstreetmap" || p.source === "osm") &&
      !(p.sources && p.sources.includes("apify"));
    if (isOsmOnly) return true;
    if (minR > 0) {
      if (p.rating == null || !Number.isFinite(Number(p.rating))) {
        if (p.source === "apify" && !(p.sources && p.sources.includes("openstreetmap"))) return false;
        return true;
      }
      if (Number(p.rating) < minR) return false;
    }
    if (minRev > 0) {
      if (p.reviews == null || !Number.isFinite(Number(p.reviews))) {
        if (p.source === "apify" && !(p.sources && p.sources.includes("openstreetmap"))) return false;
        return true;
      }
      if (Number(p.reviews) < minRev) return false;
    }
    return true;
  });
}

function sortByQuality(places) {
  return [...places].sort((a, b) => {
    const reviewsA = a.reviews == null ? -1 : Number(a.reviews) || 0;
    const reviewsB = b.reviews == null ? -1 : Number(b.reviews) || 0;
    const ratingA = a.rating == null ? -1 : Number(a.rating) || 0;
    const ratingB = b.rating == null ? -1 : Number(b.rating) || 0;
    const scoreA = (reviewsA >= 0 ? reviewsA * 10 : 0) + (ratingA >= 0 ? ratingA * 100 : 0);
    const scoreB = (reviewsB >= 0 ? reviewsB * 10 : 0) + (ratingB >= 0 ? ratingB * 100 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (a.name || "").localeCompare(b.name || "", "pt");
  });
}

function normalizeName(name) {
  return String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}
function pickNonEmpty(a, b) {
  if (a != null && a !== "" && !(Array.isArray(a) && !a.length)) return a;
  return b;
}
function mergePlaces(a, b) {
  const merged = emptyPlace();
  merged.name = pickNonEmpty(a.name, b.name);
  merged.rating = a.rating != null ? a.rating : b.rating;
  merged.reviews = a.reviews != null ? a.reviews : b.reviews;
  merged.street = pickNonEmpty(a.street, b.street);
  merged.city = pickNonEmpty(a.city, b.city);
  merged.state = pickNonEmpty(a.state, b.state);
  merged.countryCode = pickNonEmpty(a.countryCode, b.countryCode);
  merged.address = pickNonEmpty(a.address, b.address);
  merged.website = pickNonEmpty(a.website, b.website);
  merged.phone = pickNonEmpty(a.phone, b.phone);
  merged.email = pickNonEmpty(a.email, b.email);
  merged.categories = [...new Set([...(a.categories || []), ...(b.categories || [])])];
  merged.openingHours = pickNonEmpty(a.openingHours, b.openingHours);
  merged.latitude = a.latitude != null ? a.latitude : b.latitude;
  merged.longitude = a.longitude != null ? a.longitude : b.longitude;
  merged.place_id = pickNonEmpty(a.place_id, b.place_id);
  const sources = [...new Set([...(a.sources || [a.source]), ...(b.sources || [b.source])].filter(Boolean))];
  merged.sources = sources;
  merged.source = sources.length > 1 ? "combined" : (sources[0] || a.source || b.source);
  return merged;
}
function isSameBusiness(a, b) {
  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  if (phoneA && phoneB && phoneA.length >= 8 && phoneA === phoneB) return true;
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  if (!nameA || !nameB || nameA !== nameB) return false;
  if (phoneA && phoneB && phoneA.slice(-8) === phoneB.slice(-8)) return true;
  const cityA = normalizeName(a.city);
  const cityB = normalizeName(b.city);
  if (cityA && cityB && cityA === cityB) return true;
  if (a.latitude != null && b.latitude != null && a.longitude != null && b.longitude != null) {
    if (Math.abs(a.latitude - b.latitude) < 0.001 && Math.abs(a.longitude - b.longitude) < 0.001) return true;
  }
  return false;
}
function dedupeAndMerge(places) {
  const out = [];
  for (const p of places) {
    let merged = false;
    for (let i = 0; i < out.length; i++) {
      if (isSameBusiness(out[i], p)) {
        out[i] = mergePlaces(out[i], p);
        merged = true;
        break;
      }
    }
    if (!merged) out.push(p);
  }
  return out;
}
function applyFilters(places, onlyNoWebsite, minRating, minReviews) {
  let list = places;
  if (onlyNoWebsite) list = filterNoWebsite(list);
  return filterQuality(list, minRating, minReviews);
}

async function searchCombined(niche, location, fetchLimit) {
  const errors = {};
  let osmPlaces = [];
  let apifyPlaces = [];
  const tasks = [];
  tasks.push(
    searchOpenStreetMap(niche, location, fetchLimit)
      .then(r => { osmPlaces = r; })
      .catch(e => { console.log("Auto OSM falhou:", e.message); errors.openstreetmap = e.message; })
  );
  if (hasApify()) {
    tasks.push(
      searchApify(niche, location, fetchLimit)
        .then(r => { apifyPlaces = r; })
        .catch(e => { console.log("Auto Apify falhou:", e.message); errors.apify = e.message; })
    );
  } else {
    errors.apify = "APIFY_API_TOKEN não configurado";
  }
  await Promise.all(tasks);
  const places = [...osmPlaces, ...apifyPlaces];
  const partial = Object.keys(errors).length > 0 && places.length > 0;
  if (places.length === 0 && Object.keys(errors).length > 0) {
    throw new Error(
      errors.apify && errors.openstreetmap
        ? "Não foi possível obter resultados de nenhuma fonte."
        : (errors.apify || errors.openstreetmap || "Pesquisa falhou")
    );
  }
  let motor = "combined";
  if (osmPlaces.length && !apifyPlaces.length) motor = "openstreetmap";
  else if (apifyPlaces.length && !osmPlaces.length) motor = "apify";
  return { places, motor, partial, errors: Object.keys(errors).length ? errors : null, counts: { openstreetmap: osmPlaces.length, apify: apifyPlaces.length } };
}

app.post("/api/search", requireAuth, async (req, res) => {
  let usedMotor = req.body.motor || "auto";
  try {
    const {
      niche = "", location = "", motor = "auto", onlyNoWebsite = true,
      maxResults = 50, minRating = 0, minReviews = 0
    } = req.body;
    let motorNorm = motor;
    if (motorNorm === "outscraper") motorNorm = "openstreetmap";
    if (motorNorm === "osm") motorNorm = "openstreetmap";
    if (!niche.trim()) {
      return res.status(400).json({ success: false, code: "VALIDATION", error: "Escreve o nicho (ex: cabeleireiros, oficinas).", hint: null });
    }
    const fetchLimit = Math.min(Math.max(Number(maxResults) * 2, Number(maxResults)), 200);
    let places = [];
    let partial = false;
    let sourceErrors = null;
    let counts = null;
    usedMotor = motorNorm;
    if (motorNorm === "openstreetmap") {
      places = await searchOpenStreetMap(niche, location, fetchLimit);
      usedMotor = "openstreetmap";
    } else if (motorNorm === "apify") {
      places = await searchApify(niche, location, fetchLimit);
      usedMotor = "apify";
    } else {
      const result = await searchCombined(niche, location, fetchLimit);
      places = result.places;
      usedMotor = result.motor;
      partial = result.partial;
      sourceErrors = result.errors;
      counts = result.counts;
    }
    const beforeFilter = places.length;
    places = dedupeAndMerge(places);
    places = applyFilters(places, onlyNoWebsite, Number(minRating) || 0, Number(minReviews) || 0);
    places = sortByQuality(places);
    const afterFilter = places.length;
    places = places.slice(0, Number(maxResults) || 50);
    const payload = {
      success: true, motor: usedMotor, total: places.length, beforeFilter, afterFilter, partial,
      query: { niche, location, minRating, minReviews, onlyNoWebsite }, results: places
    };
    if (sourceErrors) payload.sourceErrors = sourceErrors;
    if (counts) payload.counts = counts;
    if (partial) payload.message = "Pesquisa parcial: uma das fontes falhou; a mostrar resultados disponíveis.";
    res.json(payload);
  } catch (error) {
    console.error("Erro na pesquisa:", error.message);
    const f = friendlyError(error, usedMotor);
    res.status(500).json({ success: false, code: f.code, error: f.error, hint: f.hint, motor: usedMotor });
  }
});

app.get("/api/status", requireAuth, (req, res) => {
  const osm = hasOsm();
  const apify = hasApify();
  res.json({
    osm, openstreetmap: osm, apify, outscraper: false,
    ready: osm || apify, version: "6.3.0", message: "ready"
  });
});

app.get("/", requireAuthPage, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ success: false, error: "Não encontrado." });
  }
  if (req.session && req.session.authenticated) {
    return res.sendFile(path.join(__dirname, "index.html"));
  }
  return res.redirect("/login");
});

app.listen(PORT, () => {
  console.log(`\nMaps Leads Finder em http://localhost:${PORT}`);
  console.log(`   OpenStreetMap: ok`);
  console.log(`   Apify:          ${hasApify() ? "ok" : "off"}`);
  console.log(`   Auth OTP:       ${authMissing.length ? "config em falta" : "pronto"}\n`);
});
