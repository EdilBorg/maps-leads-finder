"use strict";
const assert = require("assert");
const {
  normalizeLeadInput,
  normalizePrepStatus,
  resolveMarket,
  buildPrompt,
  systemPromptRules,
  validateMessage,
  extractGrounding,
  generateCommercialMessage,
  clearMessageCache,
  hasMeetingInvite,
  startsWithPersonalFirstName,
  claimsPreparedWebsite,
  PREP_STATUSES,
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

const okMsgPt =
  "Bom dia. Trabalho com websites profissionais para negócios locais e preparei um site para a Oficina Silva. Gostaria de marcar 10 a 15 minutos para o apresentar e falar de possíveis alterações.";

const okMsgEs =
  "Buenos días. Trabajo con sitios web profesionales y he preparado uno para Taller López. ¿Podríamos quedar 10-15 minutos para enseñárselo y comentar posibles cambios?";

async function run() {
  console.log("Gemini message unit tests\n");
  clearMessageCache();

  await test("default model is gemini-3.5-flash-lite", () => {
    assert.strictEqual(DEFAULT_MODEL, "gemini-3.5-flash-lite");
  });

  await test("system prompt rules are present and used by buildPrompt", () => {
    const rules = systemPromptRules();
    assert.match(rules, /10–15 minutos|10-15/);
    assert.match(rules, /demo/i);
    assert.match(rules, /400/);
    const lead = normalizeLeadInput({ name: "X", city: "Lisboa" });
    const p = buildPrompt(lead, "pt-PT", "listing_only", []);
    assert.ok(p.includes("IDENTIDADE") || p.includes(rules.slice(0, 40)));
    assert.match(p, /Não comeces a mensagem pelo primeiro nome/i);
  });

  await test("normalize requires name", () => {
    assert.throws(() => normalizeLeadInput({}), (e) => e.code === "MISSING_NAME");
  });

  await test("prep status prepared / in_progress / unknown + legacy boolean", () => {
    assert.strictEqual(normalizePrepStatus("prepared"), PREP_STATUSES.prepared);
    assert.strictEqual(normalizePrepStatus("in_progress"), PREP_STATUSES.in_progress);
    assert.strictEqual(normalizePrepStatus(""), PREP_STATUSES.unknown);
    assert.strictEqual(normalizeLeadInput({ name: "A", websitePrepared: true }).websitePrepStatus, "prepared");
    assert.strictEqual(normalizeLeadInput({ name: "A" }).websitePrepStatus, "unknown");
  });

  await test("resolveMarket Portugal / Spain", () => {
    assert.strictEqual(resolveMarket("auto", "Lisboa Portugal", "Lisboa", "PT"), "pt-PT");
    assert.strictEqual(resolveMarket("auto", "Madrid España", "Madrid", "ES"), "es-ES");
  });

  await test("validateMessage rejects empty, demo, first name, price, hollow formula", () => {
    assert.throws(() => validateMessage(""), (e) => e.code === "EMPTY_RESPONSE");
    assert.throws(() => validateMessage("Veja a demo do site em 10 minutos"), (e) => e.code === "REJECTED_CONTENT");
    assert.throws(
      () => validateMessage("Olá João, preparei um website e temos 10 a 15 minutos?"),
      (e) => e.code === "REJECTED_CONTENT"
    );
    assert.throws(
      () => validateMessage("Bom dia. O site custa 400 euros. Temos 10 a 15 minutos?"),
      (e) => e.code === "REJECTED_CONTENT"
    );
    assert.throws(
      () => validateMessage("Bom dia, preparei algo específico para vos mostrar. Temos 10 a 15 minutos?"),
      (e) => e.code === "REJECTED_CONTENT"
    );
  });

  await test("validateMessage rejects prepared claim when status unknown", () => {
    assert.throws(
      () =>
        validateMessage(
          "Bom dia. Preparei o website para a vossa empresa. Podemos marcar 10 a 15 minutos?",
          { websitePrepStatus: "unknown" }
        ),
      (e) => e.code === "REJECTED_CONTENT"
    );
  });

  await test("validateMessage allows prepared claim when status prepared", () => {
    const t = validateMessage(okMsgPt, { websitePrepStatus: "prepared" });
    assert.ok(t.length > 20);
  });

  await test("validateMessage requires meeting invite", () => {
    assert.throws(
      () => validateMessage("Bom dia. Trabalho com websites para empresas."),
      (e) => e.code === "REJECTED_CONTENT"
    );
  });

  await test("helpers first name and meeting", () => {
    assert.strictEqual(startsWithPersonalFirstName("Olá João, tudo bem?"), true);
    assert.strictEqual(startsWithPersonalFirstName("Bom dia. Trabalho com websites."), false);
    assert.strictEqual(hasMeetingInvite("podemos falar 10 a 15 minutos"), true);
    assert.strictEqual(claimsPreparedWebsite("preparei o website para vocês"), true);
  });

  await test("generate fails without API key", async () => {
    await assert.rejects(
      () => generateCommercialMessage({ name: "X" }, { apiKey: "", fetchFn: async () => geminiOk("x") }),
      (e) => e.code === "NO_API_KEY"
    );
  });

  await test("generate PT success with prepared status", async () => {
    clearMessageCache();
    const out = await generateCommercialMessage(
      { name: "Oficina Silva", city: "Porto", location: "Porto Portugal", websitePrepStatus: "prepared" },
      { apiKey: "k", skipCache: true, fetchFn: async () => geminiOk(okMsgPt) }
    );
    assert.ok(out.message.length > 20);
    assert.strictEqual(out.websitePrepStatus, "prepared");
    assert.ok(out.prepNote);
  });

  await test("generate ES success", async () => {
    clearMessageCache();
    const out = await generateCommercialMessage(
      { name: "Taller López", city: "Madrid", location: "Madrid España", websitePrepStatus: "prepared", market: "es-ES" },
      { apiKey: "k", skipCache: true, fetchFn: async () => geminiOk(okMsgEs) }
    );
    assert.ok(out.message.length > 20);
    assert.strictEqual(out.market, "es-ES");
  });

  await test("insufficient data still generates when model returns careful message", async () => {
    clearMessageCache();
    const msg =
      "Bom dia. Contacto-vos sobre websites profissionais para o vosso negócio. Teriam 10 a 15 minutos para uma conversa breve?";
    const out = await generateCommercialMessage(
      { name: "Empresa X" },
      { apiKey: "k", skipCache: true, fetchFn: async () => geminiOk(msg) }
    );
    assert.ok(out.message);
    assert.strictEqual(out.websitePrepStatus, "unknown");
  });

  await test("429 search then listing-only success", async () => {
    clearMessageCache();
    let n = 0;
    const out = await generateCommercialMessage(
      { name: "Loja Y", city: "Faro", location: "Portugal" },
      {
        apiKey: "k",
        skipCache: true,
        fetchFn: async (url, init) => {
          n++;
          const body = JSON.parse(init.body);
          if (body.tools) return { ok: false, status: 429, text: async () => "rate" };
          return geminiOk(
            "Bom dia. Contacto a Loja Y sobre um website profissional. Têm 10 a 15 minutos para conversarmos?"
          );
        }
      }
    );
    assert.ok(out.message);
    assert.ok(n >= 2);
  });

  await test("cache hit", async () => {
    clearMessageCache();
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return geminiOk("Bom dia. Contacto a Empresa Cache sobre websites. Têm 10 a 15 minutos?");
    };
    await generateCommercialMessage({ name: "Empresa Cache", city: "Lisboa" }, { apiKey: "k", fetchFn });
    const b = await generateCommercialMessage({ name: "Empresa Cache", city: "Lisboa" }, { apiKey: "k", fetchFn });
    assert.strictEqual(calls, 1);
    assert.strictEqual(b.cached, true);
  });

  await test("extractGrounding", () => {
    const g = extractGrounding({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://ex.pt", title: "T" } }]
          }
        }
      ]
    });
    assert.strictEqual(g.hasUseful, true);
  });

  console.log("\n%d passed, %d failed", passed, failed);
  process.exit(failed ? 1 : 0);
}

run();
