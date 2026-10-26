"use strict";

const createSearchLib = require("./search-lib");

module.exports = function mountAppCore(app, deps) {
  const {
    requireAuth,
    requireAuthPage,
    path,
    fetch,
    isProd,
    authMissing,
    PORT,
    locale,
    leadFields
  } = deps;

  const {
    hasApify,
    hasOsm,
    friendlyError,
    searchOpenStreetMap,
    searchApify,
    searchCombined,
    dedupeAndMerge,
    applyFilters,
    sortByQuality
  } = createSearchLib({ fetch, locale, leadFields });

  const messageCache = require("./message-cache");
  const messageAi = require("./message-ai");
  const { researchLead } = require("./message-research");
  const placeConstants = require("./place-constants")({ fetch });

  const aiHits = new Map();
  const AI_WINDOW_MS = 60 * 1000;
  const AI_MAX_PER_WINDOW = 10;
  function rateLimitAi(ip) {
    const now = Date.now();
    const row = aiHits.get(ip) || { t: now, n: 0 };
    if (now - row.t > AI_WINDOW_MS) {
      row.t = now;
      row.n = 0;
    }
    row.n += 1;
    aiHits.set(ip, row);
    return row.n <= AI_MAX_PER_WINDOW;
  }

  function sanitizeLead(body) {
    const lead = body && body.lead && typeof body.lead === "object" ? body.lead : {};
    const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
    return {
      name: str(lead.name, 200),
      city: str(lead.city, 120),
      address: str(lead.address, 300),
      phone: str(lead.phone, 40),
      category: str(lead.category, 120),
      website: str(lead.website, 500),
      countryCode: str(lead.countryCode, 8),
      googlePlaceId: str(lead.googlePlaceId, 200),
      osmId: str(lead.osmId, 80),
      googleMapsUrl: str(lead.googleMapsUrl, 500),
      rating: lead.rating != null && Number.isFinite(Number(lead.rating)) ? Number(lead.rating) : null,
      reviews: lead.reviews != null && Number.isFinite(Number(lead.reviews)) ? Number(lead.reviews) : null,
      sources: Array.isArray(lead.sources)
        ? lead.sources.map((s) => str(s, 40)).filter(Boolean).slice(0, 8)
        : []
    };
  }

  app.post("/api/search", requireAuth, async (req, res) => {
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
      if (motorNorm === "outscraper") motorNorm = "openstreetmap";
      if (motorNorm === "osm") motorNorm = "openstreetmap";
      if (!niche.trim()) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION",
          error: "Escreve o nicho (ex: cabeleireiros, oficinas).",
          hint: null
        });
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
        success: true,
        motor: usedMotor,
        total: places.length,
        beforeFilter,
        afterFilter,
        partial,
        query: { niche, location, minRating, minReviews, onlyNoWebsite },
        results: places
      };
      if (sourceErrors) payload.sourceErrors = sourceErrors;
      if (counts) payload.counts = counts;
      if (partial) {
        payload.message =
          "Pesquisa parcial: uma das fontes falhou; a mostrar resultados disponíveis.";
      }
      res.json(payload);
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

  app.post("/api/message/prepare", requireAuth, async (req, res) => {
    const ip = (req.ip || (req.connection && req.connection.remoteAddress) || "unknown").toString();
    if (!rateLimitAi(ip)) {
      return res.status(429).json({
        success: false,
        code: "RATE_LIMIT",
        error: "Demasiados pedidos de mensagem. Espera um minuto."
      });
    }
    try {
      const lead = sanitizeLead(req.body || {});
      if (!lead.name) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION",
          error: "Nome da empresa em falta."
        });
      }
      const commercialCountry = String((req.body && req.body.commercialCountry) || "")
        .trim()
        .toUpperCase()
        .slice(0, 8);
      const explicitLanguage = String((req.body && req.body.language) || "").trim().slice(0, 16);
      const forceRefresh = !!(req.body && req.body.forceRefresh);

      if (!forceRefresh) {
        const cached = messageCache.get(lead, commercialCountry, explicitLanguage);
        if (cached && cached.text) {
          return res.json({
            success: true,
            text: cached.text,
            cached: true,
            model: cached.model || null,
            research: cached.research || { skipped: true },
            strategyVersion: messageCache.STRATEGY_VERSION
          });
        }
      }

      const research = await researchLead(lead, {
        fetch,
        isOfficialWebsite: placeConstants.isOfficialWebsite,
        enabled: String(process.env.MESSAGE_RESEARCH_ENABLED || "").toLowerCase() === "true"
      });

      const gen = await messageAi.generateWithGemini(
        lead,
        research,
        commercialCountry,
        explicitLanguage,
        fetch
      );

      let text;
      let model = null;
      let source = "fallback";
      if (gen.ok) {
        text = gen.text;
        model = gen.model;
        source = gen.source;
      } else {
        text = messageAi.fallbackMessage(lead);
        source = "fallback";
      }

      messageCache.set(lead, commercialCountry, explicitLanguage, {
        text,
        model,
        source,
        research: {
          skipped: !!research.skipped,
          reason: research.reason || null,
          notesCount: (research.notes && research.notes.length) || 0
        },
        aiError: gen.ok ? null : { code: gen.code, error: gen.error }
      });

      res.json({
        success: true,
        text,
        cached: false,
        model,
        source,
        research: { skipped: !!research.skipped, reason: research.reason || null },
        strategyVersion: messageCache.STRATEGY_VERSION,
        warning: gen.ok ? null : { code: gen.code, error: gen.error }
      });
    } catch (e) {
      console.error("[message/prepare]", e && e.message ? e.message : e);
      res.status(500).json({
        success: false,
        code: "UNKNOWN",
        error: "Não foi possível preparar a mensagem."
      });
    }
  });

  app.get("/api/locale-options", requireAuth, (req, res) => {
    res.json({
      success: true,
      countries: locale.listCountriesForUi(),
      languages: locale.listLanguagesForUi()
    });
  });

  app.get("/api/status", requireAuth, (req, res) => {
    const osm = hasOsm();
    const apify = hasApify();
    const aiCfg = messageAi.getConfig();
    res.json({
      osm,
      openstreetmap: osm,
      apify,
      outscraper: false,
      ready: osm || apify,
      messageAi: {
        enabled: aiCfg.enabled,
        configured: !!aiCfg.apiKey,
        modelConfigured: true
      },
      version: "6.4.0",
      message: "ready"
    });
  });

  app.get("/", requireAuthPage, (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
  });

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ success: false, error: "Não encontrado." });
    }
    if (req.session && req.session.authenticated) {
      return res.sendFile(path.join(__dirname, "..", "index.html"));
    }
    return res.redirect("/login");
  });

  app.listen(PORT, () => {
    console.log(`\nMaps Leads Finder em http://localhost:${PORT}`);
    console.log(`   OpenStreetMap: ok`);
    console.log(`   Apify:          ${hasApify() ? "ok" : "off"}`);
    console.log(`   Auth OTP:       ${authMissing.length ? "config em falta" : "pronto"}`);
    const aiCfg = messageAi.getConfig();
    console.log(
      `   Message AI:     ${!aiCfg.enabled ? "off" : aiCfg.apiKey ? "ok" : "sem chave (fallback)"}\n`
    );
  });
};
