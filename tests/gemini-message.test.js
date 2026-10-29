"use strict";
const assert = require("assert");
const {
  normalizeLeadInput,
  resolveMarket,
  buildPrompt,
  validateMessage,
  extractTextFromGeminiResponse,
  extractGrounding,
  generateCommercialMessage,
  clearMessageCache,
  DEFAULT_MODEL
} = require("../lib/gemini-message");

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log("  OK", name);
    })
    .catch((e) => {
      failed++;
      console.error("  FAIL", name, e && e.message ? e.message : e);
    });
}

function geminiOk(text, grounding) {
  const cand = { content: { parts: [{ text: text }] } };
  if (grounding) cand.groundingMetadata = grounding;
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ candidates: [cand] })
  };
}

async function run() {
  console.log("Gemini message unit tests\n");
  clearMessageCache();

  await test("default model is gemini-3.5-flash-lite", () => {
    assert.strictEqual(DEFAULT_MODEL, "gemini-3.5-flash-lite");
  });

  await test("normalize requires name", () => {
    assert.throws(() => normalizeLeadInput({}), (e) => e.code === "MISSING_NAME");
  });

  await test("normalize clips and maps fields", () => {
    const n = normalizeLeadInput({
      name: "  Café Central  ",
      city: "Lisboa",
      niche: "cafés",
      market: "pt-PT"
    });
    assert.strictEqual(n.name, "Café Central");
    assert.strictEqual(n.city, "Lisboa");
    assert.strictEqual(n.market, "pt-PT");
  });

  await test("resolveMarket Portugal / Spain / English", () => {
    assert.strictEqual(resolveMarket("auto", "Lisboa Portugal", "Lisboa", "PT"), "pt-PT");
    assert.strictEqual(resolveMarket("auto", "Madrid España", "Madrid", "ES"), "es-ES");
    assert.strictEqual(resolveMarket("auto", "London UK", "London", "GB"), "en");
    assert.strictEqual(resolveMarket("es-ES", "Lisboa", "", ""), "es-ES");
  });

  await test("prompt includes commercial prospecting rules", () => {
    const lead = normalizeLeadInput({
      name: "Oficina Silva",
      city: "Porto",
      niche: "oficinas",
      location: "Porto Portugal"
    });
    const prompt = buildPrompt(lead, "pt-PT", "listing_only", []);
    assert.match(prompt, /Never invent/i);
    assert.match(prompt, /website/i);
    assert.match(prompt, /demo/i);
    assert.match(prompt, /10.?15/i);
    assert.match(prompt, /Oficina Silva/);
    assert.match(prompt, /European Portuguese|pt-PT/i);
    assert.match(prompt, /perfil digital tem margem|Forbidden empty formulas/i);
  });

  await test("prompt grounded notes do not invent when listing_only", () => {
    const lead = normalizeLeadInput({ name: "X", city: "Y", niche: "Z" });
    const p = buildPrompt(lead, "pt-PT", "listing_only", []);
    assert.match(p, /No useful or unambiguous|listing facts|Confirmed data/i);
  });

  await test("validateMessage rejects empty and demo", () => {
    assert.throws(() => validateMessage(""), (e) => e.code === "EMPTY_RESPONSE");
    assert.throws(
      () => validateMessage("Olá, posso enviar uma demo do site?"),
      (e) => e.code === "REJECTED_CONTENT"
    );
  });

  await test("validateMessage rejects empty commercial formulas", () => {
    assert.throws(
      () => validateMessage("Olá, preparei algo específico para vos mostrar sobre o vosso negócio."),
      (e) => e.code === "REJECTED_CONTENT"
    );
  });

  await test("extractGrounding reads sources", () => {
    const g = extractGrounding({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://exemplo.pt", title: "Site oficial" } }],
            groundingSupports: [{ segment: { text: "Oficina de reparação auto em Lisboa" } }]
          }
        }
      ]
    });
    assert.strictEqual(g.hasUseful, true);
    assert.strictEqual(g.sources[0].url, "https://exemplo.pt");
    assert.ok(g.notes[0].includes("Lisboa"));
  });

  await test("extractGrounding empty when no metadata", () => {
    const g = extractGrounding({ candidates: [{ content: { parts: [{ text: "hi" }] } }] });
    assert.strictEqual(g.hasUseful, false);
  });

  await test("generate fails without API key", async () => {
    await assert.rejects(
      () =>
        generateCommercialMessage(
          { name: "X", city: "Y" },
          { apiKey: "", fetchFn: async () => geminiOk("x") }
        ),
      (e) => e.code === "NO_API_KEY"
    );
  });

  await test("429 on search then success without grounding", async () => {
    clearMessageCache();
    const calls = [];
    const out = await generateCommercialMessage(
      { name: "Salão Norte", city: "Lisboa", location: "Lisboa Portugal", niche: "cabeleireiros" },
      {
        apiKey: "k",
        skipCache: true,
        fetchFn: async (url, init) => {
          const body = JSON.parse(init.body);
          calls.push({ tools: !!(body.tools && body.tools.length) });
          if (calls.length === 1) {
            return { ok: false, status: 429, text: async () => '{"error":{"code":429,"message":"Resource exhausted"}}' };
          }
          return geminiOk(
            "Olá, notei o vosso salão em Lisboa e gostaria de falar sobre o site. Têm 10 a 15 minutos esta semana?"
          );
        }
      }
    );
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].tools, true);
    assert.strictEqual(calls[1].tools, false);
    assert.ok(out.message);
    assert.strictEqual(out.researchMode, "listing_only");
    assert.strictEqual(out.searchFallback, true);
  });

  await test("429 on both search and listing-only yields GEMINI_RATE_LIMIT", async () => {
    clearMessageCache();
    let n = 0;
    await assert.rejects(
      () =>
        generateCommercialMessage(
          { name: "X", city: "Lisboa" },
          {
            apiKey: "k",
            skipCache: true,
            fetchFn: async () => {
              n++;
              return { ok: false, status: 429, text: async () => "rate" };
            }
          }
        ),
      (e) => e.code === "GEMINI_RATE_LIMIT" && e.status === 429
    );
    assert.strictEqual(n, 2);
  });

  await test("401 on search does not attempt listing-only fallback", async () => {
    clearMessageCache();
    let n = 0;
    await assert.rejects(
      () =>
        generateCommercialMessage(
          { name: "X", city: "Lisboa" },
          {
            apiKey: "k",
            skipCache: true,
            fetchFn: async () => {
              n++;
              return { ok: false, status: 401, text: async () => "auth" };
            }
          }
        ),
      (e) => e.code === "GEMINI_AUTH"
    );
    assert.strictEqual(n, 1);
  });

  await test("429 on search then 403 on listing-only surfaces auth error", async () => {
    clearMessageCache();
    let n = 0;
    await assert.rejects(
      () =>
        generateCommercialMessage(
          { name: "X", city: "Lisboa" },
          {
            apiKey: "k",
            skipCache: true,
            fetchFn: async () => {
              n++;
              if (n === 1) return { ok: false, status: 429, text: async () => "rate" };
              return { ok: false, status: 403, text: async () => "forbidden" };
            }
          }
        ),
      (e) => e.code === "GEMINI_AUTH"
    );
    assert.strictEqual(n, 2);
  });

  await test("API key sent via header not URL", async () => {
    clearMessageCache();
    let seenUrl = "";
    let seenHeaders = {};
    await generateCommercialMessage(
      { name: "Padaria Norte", city: "Braga", niche: "padarias", location: "Braga Portugal" },
      {
        apiKey: "secret-test-key",
        skipCache: true,
        fetchFn: async (url, init) => {
          seenUrl = url;
          seenHeaders = init.headers || {};
          return geminiOk(
            "Bom dia, trabalho com websites para negócios locais e gostaria de falar convosco na Padaria Norte. Têm 10 a 15 minutos?"
          );
        }
      }
    );
    assert.ok(!seenUrl.includes("secret-test-key"));
    assert.ok(!seenUrl.includes("key="));
    assert.strictEqual(seenHeaders["x-goog-api-key"], "secret-test-key");
  });

  await test("request uses google_search tool and default model name", async () => {
    clearMessageCache();
    let body = null;
    let url = "";
    await generateCommercialMessage(
      { name: "Oficina Silva", city: "Porto", location: "Porto Portugal", niche: "oficinas" },
      {
        apiKey: "k",
        skipCache: true,
        fetchFn: async (u, init) => {
          url = u;
          body = JSON.parse(init.body);
          return geminiOk(
            "Olá, trabalho com presença online para oficinas e gostaria de falar com a Oficina Silva. Proponho 10 a 15 minutos.",
            { groundingChunks: [{ web: { uri: "https://oficina-silva.example", title: "Oficina" } }] }
          );
        }
      }
    );
    assert.ok(url.includes("gemini-3.5-flash-lite"));
    assert.ok(body.tools && body.tools[0] && body.tools[0].google_search);
  });

  await test("successful research with sources", async () => {
    clearMessageCache();
    const out = await generateCommercialMessage(
      { name: "Clínica ABC", city: "Lisboa", location: "Lisboa Portugal", niche: "clínicas" },
      {
        apiKey: "k",
        skipCache: true,
        fetchFn: async () =>
          geminiOk(
            "Olá, vi a Clínica ABC em Lisboa e o vosso site oficial. Trabalho com websites para clínicas e proponho uma conversa breve de 10 a 15 minutos.",
            {
              groundingChunks: [{ web: { uri: "https://clinica-abc.pt", title: "Clínica ABC" } }],
              groundingSupports: [{ segment: { text: "Clínica dentária em Lisboa" } }]
            }
          )
      }
    );
    assert.ok(out.message.length > 20);
    assert.ok(out.sources.length >= 1);
    assert.strictEqual(out.sources[0].url, "https://clinica-abc.pt");
    assert.ok(!/\bdemo\b/i.test(out.message));
  });

  await test("search failure falls back to listing-only generation", async () => {
    clearMessageCache();
    let calls = 0;
    const out = await generateCommercialMessage(
      { name: "Loja Nova", city: "Faro", location: "Faro Portugal", niche: "lojas" },
      {
        apiKey: "k",
        skipCache: true,
        fetchFn: async (url, init) => {
          calls++;
          const body = JSON.parse(init.body);
          if (body.tools) {
            return { ok: false, status: 500, text: async () => "search down" };
          }
          return geminiOk(
            "Olá, contacto a Loja Nova em Faro sobre websites para lojas locais. Têm 10 a 15 minutos para conversarmos?"
          );
        }
      }
    );
    assert.ok(calls >= 2);
    assert.ok(out.message.length > 20);
    assert.strictEqual(out.searchFallback, true);
  });

  await test("empty first response falls back to second pass", async () => {
    clearMessageCache();
    let calls = 0;
    const out = await generateCommercialMessage(
      { name: "Atelier Rio", city: "Coimbra", niche: "atelieres", location: "Coimbra" },
      {
        apiKey: "k",
        skipCache: true,
        fetchFn: async () => {
          calls++;
          if (calls === 1) return geminiOk("");
          return geminiOk(
            "Olá, gostaria de falar com o Atelier Rio em Coimbra sobre o vosso site. Proponho 10 a 15 minutos."
          );
        }
      }
    );
    assert.ok(calls >= 2);
    assert.ok(out.message.length > 10);
  });

  await test("cache prevents duplicate API calls", async () => {
    clearMessageCache();
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return geminiOk(
        "Olá, contacto a Empresa Cache em Lisboa sobre websites. Têm 10 a 15 minutos?"
      );
    };
    const a = await generateCommercialMessage(
      { name: "Empresa Cache", city: "Lisboa", location: "Portugal" },
      { apiKey: "k", fetchFn: fetchFn }
    );
    const b = await generateCommercialMessage(
      { name: "Empresa Cache", city: "Lisboa", location: "Portugal" },
      { apiKey: "k", fetchFn: fetchFn }
    );
    assert.strictEqual(calls, 1);
    assert.strictEqual(b.cached, true);
    assert.strictEqual(a.message, b.message);
  });

  await test("homonym disambiguation appears in research hint / prompt", () => {
    const lead = normalizeLeadInput({
      name: "Farmácia Central",
      city: "Évora",
      location: "Évora Portugal",
      niche: "farmácias"
    });
    const p = buildPrompt(lead, "pt-PT", "listing_only", []);
    assert.match(p, /Farmácia Central/);
    assert.match(p, /Évora/);
  });

  console.log("\n%d passed, %d failed", passed, failed);
  process.exit(failed ? 1 : 0);
}

run();
