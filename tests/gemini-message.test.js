"use strict";
const assert = require("assert");
const {
  normalizeLeadInput,
  resolveMarket,
  buildPrompt,
  validateMessage,
  extractTextFromGeminiResponse,
  generateCommercialMessage
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
      console.error("  FAIL", name, e.message);
    });
}

async function run() {
  console.log("Gemini message unit tests\n");

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

  await test("resolveMarket Portugal default / Spain / English", () => {
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
    const prompt = buildPrompt(lead, "pt-PT");
    assert.match(prompt, /Context/i);
    assert.match(prompt, /Personalisation|Personalization/i);
    assert.match(prompt, /Curiosity/i);
    assert.match(prompt, /Meeting/i);
    assert.match(prompt, /demo/i);
    assert.match(prompt, /Oficina Silva/);
    assert.match(prompt, /European Portuguese|pt-PT/i);
  });

  await test("validateMessage rejects empty", () => {
    assert.throws(() => validateMessage(""), (e) => e.code === "EMPTY_RESPONSE");
  });

  await test("validateMessage rejects word demo", () => {
    assert.throws(
      () => validateMessage("Olá, posso enviar uma demo do site?"),
      (e) => e.code === "REJECTED_CONTENT"
    );
  });

  await test("extractTextFromGeminiResponse reads candidates", () => {
    const t = extractTextFromGeminiResponse({
      candidates: [{ content: { parts: [{ text: "Olá profissional." }] } }]
    });
    assert.strictEqual(t, "Olá profissional.");
  });

  await test("generateCommercialMessage fails without API key", async () => {
    await assert.rejects(
      () =>
        generateCommercialMessage(
          { name: "X", city: "Y" },
          { apiKey: "", fetchFn: async () => ({ ok: true, text: async () => "{}" }) }
        ),
      (e) => e.code === "NO_API_KEY"
    );
  });

  await test("generateCommercialMessage maps rate limit", async () => {
    await assert.rejects(
      () =>
        generateCommercialMessage(
          { name: "X", city: "Lisboa", location: "Portugal" },
          {
            apiKey: "test-key",
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

  await test("generateCommercialMessage success path", async () => {
    const out = await generateCommercialMessage(
      { name: "Padaria Norte", city: "Braga", niche: "padarias", location: "Braga Portugal" },
      {
        apiKey: "test-key",
        fetchFn: async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text:
                          "Bom dia, encontrei a Padaria Norte em Braga ao pesquisar a presença online de negócios locais. Trabalho com presença digital para este tipo de actividade e preparei algo concreto para vos mostrar. Teriam 10 a 15 minutos esta semana para uma conversa rápida?"
                      }
                    ]
                  }
                }
              ]
            })
        })
      }
    );
    assert.ok(out.message.includes("Padaria Norte"));
    assert.ok(!/\bdemo\b/i.test(out.message));
  });

  console.log("\n%d passed, %d failed", passed, failed);
  process.exit(failed ? 1 : 0);
}

run();
