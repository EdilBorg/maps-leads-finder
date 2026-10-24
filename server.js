/**
 * Maps Leads Finder - Backend
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

const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY || "";
const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || "";

function hasOutscraper() {
  return !!(OUTSCRAPER_API_KEY && !OUTSCRAPER_API_KEY.includes("colocar_"));
}
function hasApify() {
  return !!(APIFY_API_TOKEN && !APIFY_API_TOKEN.includes("colocar_"));
}

/** Mensagens seguras para o cliente (detalhe só no log do servidor) */
function friendlyError(err, motor) {
  const raw = (err && err.message) ? String(err.message) : String(err);
  const lower = raw.toLowerCase();

  console.error("[search error]", motor || "-", raw.slice(0, 500));

  if (lower.includes("não configurada") || lower.includes("não configurado") || lower.includes("colocar_")) {
    return {
      code: "NO_API_KEY",
      error: "O serviço de pesquisa não está disponível de momento. Tenta novamente mais tarde.",
      hint: null
    };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api") || lower.includes("authentication")) {
    return {
      code: "INVALID_KEY",
      error: "Não foi possível autenticar o serviço de pesquisa. Tenta novamente mais tarde.",
      hint: null
    };
  }
  if (lower.includes("402") || lower.includes("payment") || lower.includes("quota") || lower.includes("limit exceeded") || lower.includes("insufficient")) {
    return {
      code: "QUOTA",
      error: "O limite de pesquisas foi atingido. Tenta novamente mais tarde ou reduz o número de resultados.",
      hint: null
    };
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many")) {
    return {
      code: "RATE_LIMIT",
      error: "Demasiados pedidos em pouco tempo. Espera um minuto e tenta de novo.",
      hint: null
    };
  }
  if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("timed out")) {
    return {
      code: "TIMEOUT",
      error: "A pesquisa demorou demasiado. Reduz o máximo de resultados ou escolhe uma zona mais pequena.",
      hint: null
    };
  }
  if (lower.includes("network") || lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("enotfound")) {
    return {
      code: "NETWORK",
      error: "Não foi possível ligar ao serviço de pesquisa. Verifica a ligação e tenta de novo.",
      hint: null
    };
  }
  if (lower.includes("status: failed") || lower.includes("terminou com status")) {
    return {
      code: "RUN_FAILED",
      error: "Não foi possível concluir a pesquisa. Tenta novamente.",
      hint: null
    };
  }
  return {
    code: "UNKNOWN",
    error: "Não foi possível concluir a pesquisa. Tenta novamente.",
    hint: null
  };
}

async function searchOutscraper(query, limit = 50) {
  if (!hasOutscraper()) {
    throw new Error("OUTSCRAPER_API_KEY não configurada. Coloca a chave no ficheiro .env");
  }

  const url = `https://api.app.outscraper.com/maps/search-v3?query=${encodeURIComponent(query)}&limit=${limit}&language=pt&region=pt`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-KEY": OUTSCRAPER_API_KEY,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Outscraper erro ${response.status}: ${text}`);
  }

  const data = await response.json();
  const places = Array.isArray(data[0]) ? data[0] : (Array.isArray(data) ? data : []);

  return places.map(p => ({
    name: p.name || p.title || "",
    phone: p.phone || p.phone_number || "",
    address: p.full_address || p.address || "",
    rating: p.rating || p.rating_value || null,
    reviews: p.reviews || p.reviews_count || 0,
    website: p.site || p.website || p.domain || "",
    city: p.city || extractCity(p.full_address || p.address || ""),
    place_id: p.place_id || "",
    source: "outscraper"
  }));
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
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`
    );
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

function extractCity(address) {
  if (!address) return "";
  const parts = address.split(",");
  return parts.length > 1 ? parts[parts.length - 2].trim() : "";
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function filterNoWebsite(places) {
  return places.filter(p => {
    const site = (p.website || "").trim().toLowerCase();
    return !site || site === "null" || site === "undefined" || site === "-";
  });
}

function filterQuality(places, minRating, minReviews) {
  return places.filter(p => {
    const rating = Number(p.rating) || 0;
    const reviews = Number(p.reviews) || 0;
    if (minRating > 0 && rating < minRating) return false;
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

    if (!niche.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION",
        error: "Escreve o nicho (ex: cabeleireiros, oficinas).",
        hint: null
      });
    }

    const query = location ? `${niche}, ${location}` : niche;
    let places = [];
    usedMotor = motor;

    const fetchLimit = Math.min(Math.max(Number(maxResults) * 2, Number(maxResults)), 200);

    if (motor === "outscraper") {
      places = await searchOutscraper(query, fetchLimit);
      usedMotor = "outscraper";
    } else if (motor === "apify") {
      places = await searchApify(niche, location, fetchLimit);
      usedMotor = "apify";
    } else {
      try {
        if (hasOutscraper()) {
          places = await searchOutscraper(query, fetchLimit);
          usedMotor = "outscraper";
        } else if (hasApify()) {
          places = await searchApify(niche, location, fetchLimit);
          usedMotor = "apify";
        } else {
          return res.status(400).json({
            success: false,
            code: "NO_API_KEY",
            error: "O serviço de pesquisa não está disponível de momento. Tenta novamente mais tarde.",
            hint: null
          });
        }
      } catch (err) {
        if (hasApify() && usedMotor !== "apify") {
          console.log("Fallback Outscraper → Apify:", err.message);
          places = await searchApify(niche, location, fetchLimit);
          usedMotor = "apify";
        } else {
          throw err;
        }
      }
    }

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
  const out = hasOutscraper();
  const apify = hasApify();
  res.json({
    outscraper: out,
    apify: apify,
    ready: out || apify,
    version: "5.3.0",
    message: (out || apify) ? "ready" : "unavailable"
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`\nMaps Leads Finder em http://localhost:${PORT}`);
  console.log(`   Outscraper: ${hasOutscraper() ? "ok" : "off"}`);
  console.log(`   Apify:      ${hasApify() ? "ok" : "off"}\n`);
});
