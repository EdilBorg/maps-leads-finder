"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const messageCache = require("../lib/message-cache");
const messageAi = require("../lib/message-ai");
const { researchLead, isHttpUrl } = require("../lib/message-research");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  OK", name);
  } catch (e) {
    failed += 1;
    console.error("  FAIL", name, e.message);
  }
}

function testAsync(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log("  OK", name);
    })
    .catch((e) => {
      failed += 1;
      console.error("  FAIL", name, e.message);
    });
}

console.log("Message AI / cache / research tests\n");

test("index.html is full UI not restore marker", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(!html.includes("Temporary restore marker"));
  assert.ok(html.includes('id="searchBtn"') || html.includes("id=\"searchBtn\""));
  assert.ok(html.includes("startSearch"));
  assert.ok(html.includes("renderResults"));
  assert.ok(html.includes("exportCSV"));
  assert.ok(html.includes("commercialCountry"));
  assert.ok(html.includes("data-google-place-id"));
  assert.ok(html.includes("history.js"));
  assert.ok(html.includes("template.js"));
});

test("template does not embed API keys", () => {
  const t = fs.readFileSync(path.join(__dirname, "..", "template.js"), "utf8");
  assert.ok(!/GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20,}/.test(t));
  assert.ok(t.includes("/api/message/prepare"));
  assert.ok(t.includes("prepareMessageForSend"));
});

test("cache keys differ by company and market", () => {
  const a = { name: "Cafe A", city: "Lisboa", googlePlaceId: "ChIJ111" };
  const b = { name: "Cafe B", city: "Lisboa", googlePlaceId: "ChIJ222" };
  const k1 = messageCache.cacheKey(a, "PT", "");
  const k2 = messageCache.cacheKey(b, "PT", "");
  const k3 = messageCache.cacheKey(a, "BR", "");
  const k4 = messageCache.cacheKey(a, "PT", "en-US");
  assert.notStrictEqual(k1, k2);
  assert.notStrictEqual(k1, k3);
  assert.notStrictEqual(k1, k4);
});

test("cache get/set roundtrip and isolation", () => {
  const lead = { name: "Test Shop", city: "Porto", osmId: "node/999" + Date.now() };
  messageCache.set(lead, "PT", "", { text: "Olá PT", model: "test" });
  const hit = messageCache.get(lead, "PT", "");
  assert.ok(hit);
  assert.strictEqual(hit.text, "Olá PT");
  assert.strictEqual(messageCache.get(lead, "ES", ""), null);
  assert.strictEqual(messageCache.get(lead, "PT", "es-ES"), null);
});

test("fallback message uses lead name only", () => {
  const t = messageAi.fallbackMessage({ name: "Padaria Sol", city: "Faro" });
  assert.ok(t.includes("Padaria Sol"));
  assert.ok(t.includes("Faro"));
  assert.ok(!/demo/i.test(t));
});

test("getConfig does not expose key when missing", () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  const cfg = messageAi.getConfig();
  assert.strictEqual(cfg.apiKey, "");
  assert.ok(cfg.model);
  if (prev != null) process.env.GEMINI_API_KEY = prev;
});

test("isHttpUrl rejects non-http", () => {
  assert.strictEqual(isHttpUrl("javascript:alert(1)"), false);
  assert.strictEqual(isHttpUrl("file:///etc/passwd"), false);
  assert.strictEqual(isHttpUrl("https://example.com"), true);
});

test("app-core registers message prepare under auth", () => {
  const core = fs.readFileSync(path.join(__dirname, "..", "lib", "app-core.js"), "utf8");
  assert.ok(core.includes("/api/message/prepare"));
  assert.ok(core.includes("requireAuth"));
  assert.ok(core.includes("sanitizeLead"));
  assert.ok(core.includes("rateLimitAi"));
});

Promise.resolve()
  .then(() =>
    testAsync("research skips when disabled", async () => {
      const r = await researchLead(
        { website: "https://example.com" },
        {
          fetch: async () => {
            throw new Error("should not fetch");
          },
          isOfficialWebsite: () => true,
          enabled: false
        }
      );
      assert.strictEqual(r.skipped, true);
      assert.strictEqual(r.reason, "research_disabled");
    })
  )
  .then(() =>
    testAsync("generateWithGemini fails closed without key", async () => {
      const prev = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const r = await messageAi.generateWithGemini(
        { name: "X" },
        { notes: [] },
        "PT",
        "",
        async () => {
          throw new Error("network should not be called without key");
        }
      );
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, "NO_API_KEY");
      if (prev != null) process.env.GEMINI_API_KEY = prev;
    })
  )
  .then(() => {
    console.log("\n%d passed, %d failed", passed, failed);
    process.exit(failed ? 1 : 0);
  });
