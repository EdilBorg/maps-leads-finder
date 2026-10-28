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

  await test("default model is gemini-3.8-flash", () => {
    assert.strictEqual(DEFAULT_MODEL, "gemini-3.8-flash");
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

  await test("prompt includes four commercial requirements", () => {
    const lead = normalizeLeadInput({
      name: "Oficina Silva",
      city: "Porto",
      niche: "oficinas",
      location: "Porto Portugal"
    });
    const prompt = buildPrompt(lead, "pt-PT", "listing_only", []);
    assert.match(prompt, /Context/i);
    assert.match(prompt, /Personalisation|Personalization/i);
    assert.match(prompt, /Curiosity/i);
    assert.match(prompt, /Meeting/i);
    assert.match(prompt, /demo/i);
    assert.match(prompt, /Oficina Silva/);
    assert.match(prompt, /European Portuguese|pt-PT/i);
  });

  await test("prompt grounded notes do not invent when listing_only", () => {
    const lead = normalizeLeadInput({ name: "X", city: "Y", niche: "Z" });
    const p = buildPrompt(lead, "pt-PT", "listing_only", []);
    assert.match(p, /did not return useful|listing facts/i);
  });

  await test("validateMessage rejects empty and demo", () => {
    assert.throws(() => validateMessage(""), (e) => e.code === "EMPTY_RESPONSE");
    assert.throws(
      () => validateMessage("Olá, posso enviar uma demo do site?"),
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

  await test("generate maps rate limit", async () => {
    clearMessageCache();
    await assert.rejects(
      () =>
        generateCommercialMessage(
          { name: "X", city: "Lisboa", location: "Portugal" },
          {
            apiKey: "test-key",
            skipCache: true,
            fetchFn: async () => ({
              ok: false,
              status: 429,
              text: async () => JSON.stringify({ error: { message: "quota" } })
            })
          }
        ),
      (e) => e.code === "GEMINI_RATE_LIMIT" && e.status === 429
    );
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
            "Bom dia, encontrei a Padaria Norte em Braga. Preparei algo para vos mostrar e gostaria de uma conversa de 10 a 15 minutos."
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
            "Olá, identifiquei a Oficina Silva no Porto. Tenho algo preparado para mostrar e proponho 10 a 15 minutos de conversa.",
            { groundingChunks: [{ web: { uri: "https://oficina-silva.example", title: "Oficina" } }] }
          );
        }
      }
    );
    assert.ok(url.includes("gemini-3.8-flash"));
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
            "Olá, ao rever a Clínica ABC em Lisboa encontrei informação pública sobre a vossa actividade. Preparei algo concreto para vos mostrar e proponho uma conversa breve de 10 a 15 minutos.",
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
            "Olá, identifiquei a Loja Nova em Faro na nossa pesquisa de negócios locais. Preparei algo para mostrar e proponho 10 a 15 minutos de conversa."
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
            "Olá, encontrei o Atelier Rio em Coimbra. Tenho algo preparado para mostrar ao responsável e sugiro uma conversa de 10 a 15 minutos."
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
        "Olá, vi a Empresa Cache em Lisboa. Preparei algo para mostrar e proponho 10 a 15 minutos."
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
