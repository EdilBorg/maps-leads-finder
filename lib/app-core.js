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
    res.json({
      osm,
      openstreetmap: osm,
      apify,
      outscraper: false,
      ready: osm || apify,
      version: "6.3.2",
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
    console.log(`   Auth OTP:       ${authMissing.length ? "config em falta" : "pronto"}\n`);
  });
};
