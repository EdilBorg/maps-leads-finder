/**
 * Maps Leads Finder - Backend
 * V5.3: erros claros + estado das APIs
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

/** V5.3: traduz erros técnicos em mensagens úteis */
function friendlyError(err, motor) {
  const raw = (err && err.message) ? String(err.message) : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("não configurada") || lower.includes("não configurado") || lower.includes("colocar_")) {
    return {
      code: "NO_API_KEY",
      error: "Falta a chave de API. Abre o ficheiro .env e preenche OUTSCRAPER_API_KEY e/ou APIFY_API_TOKEN (vê .env.example).",
      hint: "cp .env.example .env  e  edita as chaves"
    };
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api") || lower.includes("authentication")) {
    return {
      code: "INVALID_KEY",
      error: "Chave de API inválida ou expirada (" + (motor || "API") + "). Verifica a key no .env.",
      hint: "Outscraper: outscraper.com | Apify: console.apify.com/account/integrations"
    };
  }
  if (lower.includes("402") || lower.includes("payment") || lower.includes("quota") || lower.includes("limit exceeded") || lower.includes("insufficient")) {
    return {
      code: "QUOTA",
      error: "Quota grátis esgotada ou saldo em falta neste motor. Tenta o outro motor (Outscraper ↔ Apify) ou espera o reset mensal.",
      hint: "No modo Automático a ferramenta tenta o motor alternativo quando um falha."
    };
  }
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many")) {
    return {
      code: "RATE_LIMIT",
      error: "Demasiados pedidos em pouco tempo. Espera 1–2 minutos e tenta de novo.",
      hint: null
    };
  }
  if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("timed out")) {
    return {
      code: "TIMEOUT",
      error: "A pesquisa demorou demasiado (comum no Apify em zonas grandes). Reduz o máx. de resultados ou escolhe uma cidade mais pequena.",
      hint: null
    };
  }
  if (lower.includes("status: failed") || lower.includes("terminou com status")) {
    return {
      code: "RUN_FAILED",
      error: "O motor não conseguiu concluir a pesquisa. Tenta de novo ou muda para o outro motor.",
      hint: raw
    };
  }
  if (lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("network") || lower.includes("enotfound")) {
    return {
      code: "NETWORK",
      error: "Sem ligação à internet ou o serviço da API está indisponível. Verifica a rede e tenta outra vez.",
      hint: null
    };
  }

  return {
    code: "UNKNOWN",
    error: raw.length > 300 ? raw.slice(0, 300) + "…" : raw,
    hint: "Se o problema continuar, troca de motor ou reduz o número de resultados."
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
        language: "pt",
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
            error: "Nenhuma API configurada. Preenche OUTSCRAPER_API_KEY ou APIFY_API_TOKEN no ficheiro .env.",
            hint: "cp .env.example .env"
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
    message: !out && !apify
      ? "Nenhuma key no .env — configura OUTSCRAPER_API_KEY ou APIFY_API_TOKEN"
      : out && apify
        ? "Outscraper e Apify prontos"
        : out
          ? "Só Outscraper configurado"
          : "Só Apify configurado"
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Maps Leads Finder V5.3 em http://localhost:${PORT}`);
  console.log(`   Outscraper: ${hasOutscraper() ? "✅" : "❌"}`);
  console.log(`   Apify:      ${hasApify() ? "✅" : "❌"}\n`);
});
