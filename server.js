/**
 * Maps Leads Finder - V2 Backend
 * Integração real com Outscraper e Apify
 *
 * Como usar:
 * 1. cp .env.example .env
 * 2. Coloca as tuas API keys no .env
 * 3. npm install
 * 4. npm start
 * 5. Abre http://localhost:3000
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
app.use(express.static(path.join(__dirname))); // serve o index.html

// ============================================
// CONFIGURAÇÃO - Lê as chaves do .env
// ============================================
const OUTSCRAPER_API_KEY = process.env.OUTSCRAPER_API_KEY || "";
const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || "";

// ============================================
// OUTSCRAPER
// Docs: https://outscraper.com/api-docs/
// ============================================
async function searchOutscraper(query, limit = 50) {
  if (!OUTSCRAPER_API_KEY || OUTSCRAPER_API_KEY.includes("colocar_")) {
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

  // Outscraper devolve array de arrays (por query). Pegamos o primeiro.
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

// ============================================
// APIFY - Google Maps Scraper (compass/crawler-google-places)
// Docs: https://apify.com/compass/crawler-google-places
// ============================================
async function searchApify(query, location, limit = 50) {
  if (!APIFY_API_TOKEN || APIFY_API_TOKEN.includes("colocar_")) {
    throw new Error("APIFY_API_TOKEN não configurado. Coloca o token no ficheiro .env");
  }

  const searchString = location ? `${query} ${location}` : query;

  // 1. Iniciar o Actor
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

  // 2. Esperar o Actor terminar (polling simples)
  let status = "RUNNING";
  let attempts = 0;
  const maxAttempts = 60; // ~2 minutos

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

  // 3. Buscar os resultados do dataset
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

// ============================================
// UTILITÁRIOS
// ============================================
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

// ============================================
// ROTA PRINCIPAL DE PESQUISA
// ============================================
app.post("/api/search", async (req, res) => {
  try {
    const {
      niche = "",
      location = "",
      motor = "auto",
      onlyNoWebsite = true,
      maxResults = 50
    } = req.body;

    if (!niche.trim()) {
      return res.status(400).json({ error: "O campo 'nicho' é obrigatório." });
    }

    const query = location ? `${niche}, ${location}` : niche;
    let places = [];
    let usedMotor = motor;

    // Lógica de escolha do motor
    if (motor === "outscraper") {
      places = await searchOutscraper(query, maxResults);
      usedMotor = "outscraper";
    } else if (motor === "apify") {
      places = await searchApify(niche, location, maxResults);
      usedMotor = "apify";
    } else {
      // AUTO: tenta Outscraper primeiro, se falhar ou não tiver key, usa Apify
      try {
        if (OUTSCRAPER_API_KEY && !OUTSCRAPER_API_KEY.includes("colocar_")) {
          places = await searchOutscraper(query, maxResults);
          usedMotor = "outscraper";
        } else if (APIFY_API_TOKEN && !APIFY_API_TOKEN.includes("colocar_")) {
          places = await searchApify(niche, location, maxResults);
          usedMotor = "apify";
        } else {
          return res.status(400).json({
            error: "Nenhuma API key configurada. Coloca OUTSCRAPER_API_KEY ou APIFY_API_TOKEN no ficheiro .env"
          });
        }
      } catch (err) {
        // Fallback para Apify se Outscraper falhar
        if (APIFY_API_TOKEN && !APIFY_API_TOKEN.includes("colocar_")) {
          console.log("Outscraper falhou, a tentar Apify...", err.message);
          places = await searchApify(niche, location, maxResults);
          usedMotor = "apify";
        } else {
          throw err;
        }
      }
    }

    // Filtro automático: apenas sem website
    if (onlyNoWebsite) {
      places = filterNoWebsite(places);
    }

    // Limitar resultados
    places = places.slice(0, maxResults);

    res.json({
      success: true,
      motor: usedMotor,
      total: places.length,
      query: { niche, location },
      results: places
    });

  } catch (error) {
    console.error("Erro na pesquisa:", error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rota de estado das keys (para o frontend mostrar se estão configuradas)
app.get("/api/status", (req, res) => {
  res.json({
    outscraper: !!(OUTSCRAPER_API_KEY && !OUTSCRAPER_API_KEY.includes("colocar_")),
    apify: !!(APIFY_API_TOKEN && !APIFY_API_TOKEN.includes("colocar_")),
    version: "2.0.0"
  });
});

// Fallback: servir o index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Maps Leads Finder V2 a correr em http://localhost:${PORT}`);
  console.log(`   Outscraper: ${OUTSCRAPER_API_KEY && !OUTSCRAPER_API_KEY.includes("colocar_") ? "✅ configurado" : "❌ falta a key"}`);
  console.log(`   Apify:      ${APIFY_API_TOKEN && !APIFY_API_TOKEN.includes("colocar_") ? "✅ configurado" : "❌ falta o token"}\n`);
});
