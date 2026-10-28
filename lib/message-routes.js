"use strict";

const { generateCommercialMessage, MARKET_LOCALES } = require("./gemini-message");

function mountMessageRoutes(app, deps) {
  const requireAuth = deps && deps.requireAuth;
  if (!app || typeof app.post !== "function" || !requireAuth) {
    throw new Error("mountMessageRoutes: app and requireAuth required");
  }

  app.get("/api/messages/markets", requireAuth, (req, res) => {
    res.json({
      success: true,
      markets: [
        { id: "auto", label: "Automático (pela localização)" },
        { id: "pt-PT", label: "Portugal (português europeu)" },
        { id: "es-ES", label: "Espanha (espanhol)" },
        { id: "en", label: "Inglês" }
      ]
    });
  });

  app.post("/api/messages/generate", requireAuth, async (req, res) => {
    try {
      const result = await generateCommercialMessage(req.body || {});
      res.json({
        success: true,
        message: result.message,
        market: result.market
      });
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      const code = e && e.code ? e.code : "UNKNOWN";
      console.error("[messages/generate]", code, (e && e.message) || e);
      res.status(status).json({
        success: false,
        code,
        error: (e && e.message) || "Não foi possível gerar a mensagem."
      });
    }
  });
}

module.exports = { mountMessageRoutes };
