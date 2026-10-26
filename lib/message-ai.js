"use strict";

const STRATEGY_VERSION = require("./message-cache").STRATEGY_VERSION;

function getConfig() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const model =
    process.env.GEMINI_MODEL || process.env.MESSAGE_AI_MODEL || "gemini-3.5-flash-lite";
  const enabled = String(process.env.MESSAGE_AI_ENABLED || "true").toLowerCase() !== "false";
  return {
    apiKey: apiKey && !apiKey.includes("colocar_") ? apiKey : "",
    model,
    enabled,
    endpointBase: "https://generativelanguage.googleapis.com/v1beta"
  };
}

function buildSystemInstruction(commercialCountry, explicitLanguage) {
  const langHint = explicitLanguage
    ? `Write the entire message in language/locale: ${explicitLanguage}.`
    : commercialCountry
      ? `Choose the natural language and regional variant for commercial market country code: ${commercialCountry} (e.g. PT→European Portuguese, BR→Brazilian Portuguese, ES→Spanish from Spain, GB→British English, US→American English).`
      : "Write in European Portuguese unless the lead clearly indicates otherwise.";

  return [
    "You write a short first-contact WhatsApp/SMS style message to a local business.",
    "Four required elements: (1) context that you noticed this specific business from available data;",
    "(2) personalization only from verified facts provided — never invent services, websites, or history;",
    "(3) curiosity that you have something prepared to show them (do NOT use the word demo);",
    "(4) a natural invite to a 10–15 minute meeting as a question.",
    "Do not list prices, feature bullets, or aggressive sales pitch.",
    "Do not claim you already built a full website for them.",
    "Do not claim they have no website unless the facts say so explicitly.",
    "If research notes are empty, use only the lead fields provided.",
    "Output ONLY the message text, no quotes, no markdown, no preamble.",
    langHint
  ].join(" ");
}

function buildUserPrompt(lead, research, commercialCountry, explicitLanguage) {
  const facts = {
    name: lead.name || "",
    city: lead.city || "",
    address: lead.address || "",
    phone: lead.phone || "",
    category: lead.category || "",
    website: lead.website || "",
    rating: lead.rating != null ? lead.rating : null,
    reviews: lead.reviews != null ? lead.reviews : null,
    countryCode: lead.countryCode || "",
    sources: lead.sources || []
  };
  const notes = (research && research.notes) || [];
  return JSON.stringify({
    commercialCountry: commercialCountry || "",
    explicitLanguage: explicitLanguage || "",
    strategyVersion: STRATEGY_VERSION,
    leadFacts: facts,
    researchNotes: notes.map((n) => ({ source: n.source, excerpt: n.excerpt }))
  });
}

async function generateWithGemini(lead, research, commercialCountry, explicitLanguage, fetchFn) {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return { ok: false, code: "AI_DISABLED", error: "Geração por IA desativada (MESSAGE_AI_ENABLED=false)." };
  }
  if (!cfg.apiKey) {
    return {
      ok: false,
      code: "NO_API_KEY",
      error: "GEMINI_API_KEY não configurada. Define a chave no .env (nível gratuito Gemini Flash-Lite)."
    };
  }

  const url =
    cfg.endpointBase +
    "/models/" +
    encodeURIComponent(cfg.model) +
    ":generateContent?key=" +
    encodeURIComponent(cfg.apiKey);

  const body = {
    systemInstruction: { parts: [{ text: buildSystemInstruction(commercialCountry, explicitLanguage) }] },
    contents: [
      {
        role: "user",
        parts: [{ text: buildUserPrompt(lead, research, commercialCountry, explicitLanguage) }]
      }
    ],
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || "Erro do fornecedor de IA (" + res.status + ").";
      return {
        ok: false,
        code: res.status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR",
        error: String(msg).slice(0, 300),
        model: cfg.model
      };
    }
    const text =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts
        ? data.candidates[0].content.parts.map((p) => p.text || "").join("").trim()
        : "";
    if (!text) {
      return { ok: false, code: "EMPTY_RESPONSE", error: "A IA não devolveu texto.", model: cfg.model };
    }
    return { ok: true, text, model: cfg.model, source: "gemini" };
  } catch (e) {
    const code = e && e.name === "AbortError" ? "TIMEOUT" : "NETWORK";
    return {
      ok: false,
      code,
      error: code === "TIMEOUT" ? "Timeout na geração da mensagem." : "Falha de rede ao contactar a IA.",
      model: cfg.model
    };
  } finally {
    clearTimeout(timer);
  }
}

function fallbackMessage(lead) {
  const name = (lead && lead.name) || "a vossa empresa";
  const city = (lead && lead.city) || "";
  const where = city ? " em " + city : "";
  return (
    "Olá! Vi o " +
    name +
    where +
    " e estive a analisar os dados públicos disponíveis. Preparei algo concreto para vos mostrar — teriam 10–15 minutos esta semana para uma conversa rápida?"
  );
}

module.exports = {
  getConfig,
  generateWithGemini,
  fallbackMessage,
  buildSystemInstruction,
  buildUserPrompt
};
