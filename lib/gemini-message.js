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
    err.code = "BAD_REQUEST";
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
  if (/\bportugal\b|\blisboa\b|\bporto\b|\bportugal\b/.test(blob) || countryCode === "PT") {
    return "pt-PT";
  }
  if (/\bunited kingdom\b|\buk\b|\busa\b|\bunited states\b|\benglish\b/.test(blob)) return "en";
  return "pt-PT";
}

function buildPrompt(lead, marketKey, researchMode, groundedNotes) {
  const locale = MARKET_LOCALES[marketKey] || MARKET_LOCALES["pt-PT"];
  const listing = [
    "Name: " + lead.name,
    lead.category ? "Category: " + lead.category : "",
    lead.niche ? "Search niche: " + lead.niche : "",
    lead.city ? "City: " + lead.city : "",
    lead.location ? "Search location: " + lead.location : "",
    lead.address ? "Address: " + lead.address : "",
    lead.hasWebsite ? "Listing shows a website field." : "Listing does not show a website.",
    lead.rating != null && !Number.isNaN(lead.rating) ? "Rating: " + lead.rating : "",
    lead.reviews != null && !Number.isNaN(lead.reviews) ? "Reviews: " + lead.reviews : ""
  ]
    .filter(Boolean)
    .join("\n");

  const researchBlock =
    researchMode === "grounded" && groundedNotes && groundedNotes.length
      ? "Confirmed public-web findings (use only these extra facts):\n- " + groundedNotes.join("\n- ")
      : "Web research did not return useful or unambiguous results for this specific business.\nUse ONLY the listing facts below. Do not invent services, social profiles, problems, or website status beyond what the listing facts state.";

  return [
    "You write a short first-touch commercial WhatsApp message to a local business decision-maker.",
    locale.instruction,
    "Requirements:",
    "1) Context: show we found the business and looked at its online presence. Do NOT claim we visited a website or social profiles unless that is in the confirmed findings.",
    "2) Personalisation: use at least one confirmed detail (activity/category/location). Never invent services, praise, problems, or contact data.",
    "3) Curiosity: say we have something prepared to show the person in charge. Never use the word demo.",
    "4) Meeting: naturally invite a short 10-15 minute conversation.",
    "Tone: professional, natural, concise. No bullet lists. No subject line. No signature block. No hashtags.",
    "Output only the message body text.",
    researchBlock,
    "Listing facts:",
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
    err.code = "EMPTY_MESSAGE";
    err.status = 502;
    throw err;
  }
  if (/\bdemo\b/i.test(t)) {
    const err = new Error("A mensagem gerada foi rejeitada (conteúdo não permitido).");
    err.code = "REJECTED_CONTENT";
    err.status = 502;
    throw err;
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
  }

  let researchMode = "listing_only";
  let grounded = { hasUseful: false, sources: [], notes: [], ambiguous: false };
  const researchHint = [
    "Research this specific local business on the public web before composing the message.",
    "Search query focus: \"" + lead.name + "\" " + [lead.city, lead.location].filter(Boolean).join(" "),
    "Prefer official website and official social profiles for this business only; ignore similarly named companies in other cities.",
    "Then write the WhatsApp message as instructed."
  ].join("\n");

  let messageText = "";
  let usedSearch = false;

  try {
    const first = await callGemini(fetchFn, {
      model: model,
      apiKey: apiKey,
      prompt: buildPrompt(lead, marketKey, "listing_only", []).replace(
        "Web research did not return useful or unambiguous results for this specific business.\nUse ONLY the listing facts below. Do not invent services, social profiles, problems, or website status beyond what the listing facts state.",
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
