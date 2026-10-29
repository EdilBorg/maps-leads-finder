"use strict";

/**
 * Commercial message generation via Google Gemini.
 * Uses google_search grounding when available; falls back to listing data only.
 * Default model: gemini-3.5-flash-lite (official model code; Search grounding supported).
 * Override with GEMINI_MODEL. API key via GEMINI_API_KEY (never logged).
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MAX_MESSAGE_CHARS = 900;
const CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env.GEMINI_CACHE_TTL_MS) || 15 * 60 * 1000, 60 * 1000),
  24 * 60 * 60 * 1000
);
const MAX_CACHE_ENTRIES = 200;

const MARKET_LOCALES = {
  auto: null,
  "pt-PT": {
    label: "Portugal",
    language: "European Portuguese (pt-PT)",
    instruction: "Write in European Portuguese (Portugal), not Brazilian Portuguese."
  },
  "es-ES": {
    label: "España",
    language: "Spanish (Spain)",
    instruction: "Write in Spanish from Spain (castellano), not Latin American variants."
  },
  en: {
    label: "English",
    language: "English",
    instruction: "Write in natural professional English."
  }
};

const responseCache = new Map();
const inflight = new Map();

function getGeminiKey() {
  const k = process.env.GEMINI_API_KEY || "";
  if (!k || k.includes("colocar_")) return "";
  return k.trim();
}

function clip(s, n) {
  const t = String(s == null ? "" : s).trim();
  if (t.length <= n) return t;
  return t.slice(0, n);
}

function normalizeLeadInput(body) {
  const b = body || {};
  const name = clip(b.name, 120);
  if (!name) {
    const err = new Error("Nome da empresa em falta.");
    err.code = "MISSING_NAME";
    err.status = 400;
    throw err;
  }
  return {
    name: name,
    city: clip(b.city, 80),
    address: clip(b.address, 160),
    category: clip(b.category, 80),
    niche: clip(b.niche, 80),
    location: clip(b.location, 120),
    website: clip(b.website, 200),
    hasWebsite: !!b.hasWebsite || !!clip(b.website, 200),
    rating: b.rating != null && b.rating !== "" ? Number(b.rating) : null,
    reviews: b.reviews != null && b.reviews !== "" ? Number(b.reviews) : null,
    market: clip(b.market || "auto", 16),
    countryCode: clip(b.countryCode, 8)
  };
}

function resolveMarket(market, location, city, countryCode) {
  const m = String(market || "auto").trim();
  if (m && m !== "auto" && MARKET_LOCALES[m]) return m;
  const blob = [location, city, countryCode].filter(Boolean).join(" ").toLowerCase();
  if (/\bespaña\b|\bespanha\b|\bspain\b|\bmadrid\b|\bbarcelona\b|\bvalencia\b|\bsevilla\b/.test(blob) || countryCode === "ES") {
    return "es-ES";
  }
  if (/\bportugal\b|\blisboa\b|\bporto\b/.test(blob) || countryCode === "PT") {
    return "pt-PT";
  }
  if (/\bunited kingdom\b|\buk\b|\busa\b|\bunited states\b|\benglish\b/.test(blob)) return "en";
  return "pt-PT";
}

function buildPrompt(lead, marketKey, researchMode, groundedNotes) {
  const locale = MARKET_LOCALES[marketKey] || MARKET_LOCALES["pt-PT"];
  const listing = [
    "Business name: " + lead.name,
    lead.category ? "Category: " + lead.category : "",
    lead.niche ? "Search niche (context only, do not quote as if we cold-found them via Maps): " + lead.niche : "",
    lead.city ? "City: " + lead.city : "",
    lead.location ? "Region/search area: " + lead.location : "",
    lead.address ? "Address (do NOT mention street/address in the message unless a concrete commercial reason exists): " + lead.address : "",
    lead.hasWebsite ? "Listing includes a website field (do not invent what is on it)." : "Listing does not show a website field (do NOT claim the business has no website at all).",
    lead.rating != null && !Number.isNaN(lead.rating) ? "Rating: " + lead.rating : "",
    lead.reviews != null && !Number.isNaN(lead.reviews) ? "Review count: " + lead.reviews : ""
  ]
    .filter(Boolean)
    .join("\n");

  const researchBlock =
    researchMode === "grounded" && groundedNotes && groundedNotes.length
      ? "Verified public-web findings for THIS business only (you may use these facts):\n- " + groundedNotes.join("\n- ")
      : "No useful or unambiguous web research for this specific business.\nUse ONLY confirmed listing facts. Do not invent digital problems, services, social activity, clients, or website status.";

  return [
    "You are a B2B commercial prospecting specialist and copywriter who sells professional websites to small businesses in Portugal and Spain.",
    "Goal: write a short first-contact WhatsApp message to start a conversation about their website — natural, credible, human.",
    locale.instruction,
    "Mandatory rules:",
    "1) Analyse listing facts and verified findings before writing. Never invent business info, services, digital presence, clients, or problems.",
    "2) Do NOT claim you analysed a website, social profiles, or digital positioning unless verified findings prove it.",
    "3) Do NOT mention street, address, or how we found the contact (no Google Maps / search narrative) without a concrete commercial reason.",
    "4) Forbidden empty formulas (never use as automatic openers): \"Preparei algo específico para vos mostrar\", \"O vosso perfil digital tem margem para melhorar\", \"Estive a analisar o vosso posicionamento digital\", and close equivalents in ES/EN unless hard evidence justifies a similar claim.",
    "5) Do not start every message the same way. Adapt to the real business.",
    "6) Do not force a commercial angle when data is too thin; stay prudent with confirmed context only.",
    "7) Natural, professional, direct language. No robotic tone, no fake praise, no long text, no bullet lists, no subject line, no signature, no hashtags.",
    "8) When it makes sense, end with a simple invitation to a brief 10–15 minute conversation — without pressure.",
    "9) Never promise business results. Never assert they need a new website without enough evidence. Never use the word demo.",
    "10) Output ONLY the final message body. If personalisation is weak due to missing facts, still write a careful short message without inventing observations.",
    researchBlock,
    "Confirmed data:",
    listing
  ].join("\n");
}

function extractTextFromGeminiResponse(data) {
  const cands = data && data.candidates;
  if (!Array.isArray(cands) || !cands.length) return "";
  const parts = cands[0].content && cands[0].content.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map(function (p) {
      return p && p.text ? String(p.text) : "";
    })
    .join("")
    .trim();
}

function extractGrounding(data) {
  const cand = data && data.candidates && data.candidates[0];
  const gm = cand && (cand.groundingMetadata || cand.grounding_metadata);
  if (!gm) return { hasUseful: false, sources: [], notes: [], ambiguous: false };
  const sources = [];
  const notes = [];
  const chunks = gm.groundingChunks || gm.grounding_chunks || [];
  for (const ch of chunks) {
    const web = ch.web || ch.retrievedContext || {};
    const uri = web.uri || web.url || "";
    const title = web.title || "";
    if (uri) sources.push({ url: String(uri).slice(0, 300), title: String(title).slice(0, 120) });
  }
  const supports = gm.groundingSupports || gm.grounding_supports || [];
  for (const s of supports) {
    const seg = s.segment && s.segment.text;
    if (seg) notes.push(clip(seg, 200));
  }
  const hasUseful = sources.length > 0 || notes.length > 0;
  return { hasUseful: hasUseful, sources: sources.slice(0, 8), notes: notes.slice(0, 6), ambiguous: false };
}

function validateMessage(text) {
  const t = String(text || "").trim();
  if (!t) {
    const err = new Error("A geração não devolveu texto útil.");
    err.code = "EMPTY_RESPONSE";
    err.status = 502;
    throw err;
  }
  if (/\bdemo\b/i.test(t)) {
    const err = new Error("A mensagem gerada foi rejeitada (conteúdo não permitido).");
    err.code = "REJECTED_CONTENT";
    err.status = 502;
    throw err;
  }
  const banned = [
    /preparei algo espec[ií]fico para vos mostrar/i,
    /o vosso perfil digital tem margem/i,
    /estive a analisar o (vosso )?posicionamento digital/i,
    /he preparado algo espec[ií]fico/i,
    /su perfil digital tiene margen/i,
    /estuve analizando (su |vuestro )?posicionamiento digital/i
  ];
  for (const re of banned) {
    if (re.test(t)) {
      const err = new Error("A mensagem gerada foi rejeitada (formulismo comercial vazio).");
      err.code = "REJECTED_CONTENT";
      err.status = 502;
      throw err;
    }
  }
  if (t.length > MAX_MESSAGE_CHARS) return t.slice(0, MAX_MESSAGE_CHARS).trim();
  return t;
}

function mapGeminiHttpError(status, bodyText) {
  const err = new Error("Não foi possível gerar a mensagem. Tenta novamente.");
  err.status = 502;
  err.code = "GEMINI_ERROR";
  if (status === 401 || status === 403) {
    err.code = "GEMINI_AUTH";
    err.message = "A geração de mensagens não está configurada correctamente.";
  } else if (status === 429) {
    err.code = "GEMINI_RATE_LIMIT";
    err.status = 429;
    err.message = "Limite de pedidos atingido. Espera um momento e tenta de novo.";
  } else if (status === 400) {
    err.code = "GEMINI_BAD_REQUEST";
    err.message = "Não foi possível gerar a mensagem com os dados fornecidos.";
  }
  err.detail = typeof bodyText === "string" ? bodyText.slice(0, 200) : "";
  return err;
}

function cacheKey(lead, marketKey, model) {
  return [model, marketKey, lead.name, lead.city, lead.location, lead.niche, lead.category, lead.hasWebsite ? "1" : "0"]
    .join("|")
    .toLowerCase();
}

function cacheGet(key) {
  const e = responseCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    responseCache.delete(key);
    return null;
  }
  return e.value;
}

function cacheSet(key, value) {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const first = responseCache.keys().next().value;
    if (first != null) responseCache.delete(first);
  }
  responseCache.set(key, { expires: Date.now() + CACHE_TTL_MS, value: value });
}

function clearMessageCache() {
  responseCache.clear();
}

async function callGemini(fetchFn, opts) {
  const model = opts.model;
  const apiKey = opts.apiKey;
  const prompt = opts.prompt;
  const useSearch = opts.useSearch;
  const timeoutMs = opts.timeoutMs;
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent";
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
  };
  if (useSearch) body.tools = [{ google_search: {} }];
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller && timeoutMs ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
    const rawText = await res.text();
    let data = null;
    try { data = rawText ? JSON.parse(rawText) : null; } catch (_) { data = null; }
    return { res: res, rawText: rawText, data: data };
  } catch (e) {
    if (e && e.name === "AbortError") {
      const err = new Error("A geração demorou demasiado. Tenta novamente.");
      err.code = "TIMEOUT";
      err.status = 504;
      throw err;
    }
    const err = new Error("Não foi possível contactar o serviço de geração.");
    err.code = "NETWORK";
    err.status = 502;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function logGeminiHttp(context, model, status, bodyText) {
  const detail = typeof bodyText === "string" ? bodyText.slice(0, 300) : "";
  console.error(
    "[gemini]",
    context,
    "model=" + model,
    "http=" + status,
    detail ? "detail=" + detail.replace(/\s+/g, " ").trim() : "detail="
  );
}

async function generateCommercialMessage(body, opts) {
  const options = opts || {};
  const fetchFn = options.fetchFn || fetch;
  const apiKey = options.apiKey != null ? options.apiKey : getGeminiKey();
  const model = options.model || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs || Number(process.env.GEMINI_TIMEOUT_MS) || 45000;

  if (!apiKey) {
    const err = new Error("A geração de mensagens não está disponível de momento.");
    err.code = "NO_API_KEY";
    err.status = 503;
    throw err;
  }

  const lead = normalizeLeadInput(body);
  const marketKey = resolveMarket(lead.market, lead.location, lead.city, lead.countryCode);
  const key = cacheKey(lead, marketKey, model);

  if (!options.skipCache) {
    const hit = cacheGet(key);
    if (hit) return Object.assign({}, hit, { cached: true });
    if (inflight.has(key)) return inflight.get(key);
  }

  const work = (async function () {
  let researchMode = "listing_only";
  let grounded = { hasUseful: false, sources: [], notes: [], ambiguous: false };
  const researchHint = [
    "Before writing, research this specific local business on the public web.",
    "Search focus: \"" + lead.name + "\" " + [lead.city, lead.location].filter(Boolean).join(" "),
    "Prefer official website and official social profiles for THIS business in THIS location; ignore homonyms elsewhere.",
    "Only treat findings as usable if they clearly match the same business. Do not invent gaps or opportunities.",
    "Then write the WhatsApp message following the mandatory rules."
  ].join("\n");

  let messageText = "";
  let usedSearch = false;

  try {
    const first = await callGemini(fetchFn, {
      model: model,
      apiKey: apiKey,
      prompt: buildPrompt(lead, marketKey, "listing_only", []).replace(
        "No useful or unambiguous web research for this specific business.\nUse ONLY confirmed listing facts. Do not invent digital problems, services, social activity, clients, or website status.",
        researchHint +
          "\nAfter searching, write the message using only confirmed findings about this business in this location plus listing facts. If search is empty or ambiguous, rely only on listing facts."
      ),
      useSearch: true,
      timeoutMs: timeoutMs
    });

    if (!first.res.ok) {
      logGeminiHttp("search_call", model, first.res.status, first.rawText);
      const searchError = mapGeminiHttpError(first.res.status, first.rawText);
      if (first.res.status === 401 || first.res.status === 403) throw searchError;
    } else {
      grounded = extractGrounding(first.data);
      usedSearch = true;
      if (grounded.hasUseful && !grounded.ambiguous) researchMode = "grounded";
      try {
        messageText = validateMessage(extractTextFromGeminiResponse(first.data));
      } catch (ve) {
        messageText = "";
      }
    }
  } catch (e) {
    if (e && (e.code === "GEMINI_AUTH" || e.code === "NO_API_KEY")) throw e;
  }

  if (!messageText) {
    const second = await callGemini(fetchFn, {
      model: model,
      apiKey: apiKey,
      prompt: buildPrompt(lead, marketKey, "listing_only", []),
      useSearch: false,
      timeoutMs: timeoutMs
    });
    if (!second.res.ok) {
      logGeminiHttp("listing_only_call", model, second.res.status, second.rawText);
      throw mapGeminiHttpError(second.res.status, second.rawText);
    }
    messageText = validateMessage(extractTextFromGeminiResponse(second.data));
    researchMode = "listing_only";
  }

  const result = {
    message: messageText,
    market: marketKey,
    model: model,
    researchMode: researchMode,
    sources: grounded.sources || [],
    searchUsed: usedSearch,
    searchFallback: researchMode === "listing_only",
    cached: false
  };

  cacheSet(key, {
    message: result.message,
    market: result.market,
    model: result.model,
    researchMode: result.researchMode,
    sources: result.sources,
    searchUsed: result.searchUsed,
    searchFallback: result.searchFallback
  });

  return result;
  })();

  if (!options.skipCache) {
    inflight.set(key, work);
    work.finally(function () {
      inflight.delete(key);
    });
  }
  return work;
}

module.exports = {
  generateCommercialMessage: generateCommercialMessage,
  normalizeLeadInput: normalizeLeadInput,
  resolveMarket: resolveMarket,
  buildPrompt: buildPrompt,
  validateMessage: validateMessage,
  extractGrounding: extractGrounding,
  extractTextFromGeminiResponse: extractTextFromGeminiResponse,
  mapGeminiHttpError: mapGeminiHttpError,
  clearMessageCache: clearMessageCache,
  cacheKey: cacheKey,
  getGeminiKey: getGeminiKey,
  DEFAULT_MODEL: DEFAULT_MODEL
};
