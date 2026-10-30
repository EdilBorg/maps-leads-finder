"use strict";
/**
 * Ensures lib/gemini-message.js has commercial strategy + stability fixes.
 * Applies surgical patches when markers are missing. Idempotent.
 * Claims validation must require website/site noun + prepared claim (not "he preparado" alone).
 */
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "lib", "gemini-message.js");
let src = "";
try {
  src = fs.readFileSync(target, "utf8");
} catch (e) {
  console.warn("[ensure-gemini-commercial] cannot read", target);
  process.exit(0);
}

const required = [
  "function systemPromptRules",
  "claimsPreparedWebsite",
  "STRATEGY_VERSION",
  "CINCO PASSOS"
];
const missingCore = required.filter(function (m) {
  return src.indexOf(m) === -1;
});
if (missingCore.length) {
  console.warn("[ensure-gemini-commercial] core strategy missing:", missingCore.join(", "));
  process.exit(0);
}

let changed = false;

if (src.indexOf("work.finally(function () { inflight.delete(key); });") !== -1) {
  src = src.replace(
    "work.finally(function () { inflight.delete(key); });",
    "const cleanup = function () { inflight.delete(key); };\n    work.then(cleanup, cleanup);"
  );
  changed = true;
  console.log("[ensure-gemini-commercial] patched inflight cleanup");
}

if (src.indexOf("isQuotaExhaustedBody") === -1 && src.indexOf("function mapGeminiHttpError") !== -1) {
  const helper =
    "function isQuotaExhaustedBody(bodyText) {\n" +
    "  const t = String(bodyText || \"\").toLowerCase();\n" +
    "  if (!t) return false;\n" +
    "  if (/exceeded your current quota|check your plan and billing|quota.*exhausted|free_tier|GenerateRequestsPerDay|daily.*quota|billing details/i.test(t)) return true;\n" +
    "  if (/RESOURCE_EXHAUSTED/i.test(t) && /quota|billing|plan/i.test(t)) return true;\n" +
    "  if (/resource has been exhausted/i.test(t) && /check quota/i.test(t)) return true;\n" +
    "  return false;\n" +
    "}\n\n";
  src = src.replace("function mapGeminiHttpError", helper + "function mapGeminiHttpError");
  const old429 =
    'else if (status === 429) { err.code = "GEMINI_RATE_LIMIT"; err.status = 429; err.message = "Limite de pedidos atingido. Espera um momento e tenta de novo."; }';
  const new429 =
    'else if (status === 429) {\n' +
    "    if (isQuotaExhaustedBody(bodyText)) {\n" +
    '      err.code = "GEMINI_QUOTA_EXCEEDED";\n' +
    "      err.status = 503;\n" +
    '      err.message = "Serviço de geração temporariamente indisponível. Tenta mais tarde.";\n' +
    "      err.retryable = false;\n" +
    "    } else {\n" +
    '      err.code = "GEMINI_RATE_LIMIT";\n' +
    "      err.status = 429;\n" +
    '      err.message = "Limite de pedidos atingido. Espera um momento e tenta de novo.";\n' +
    "      err.retryable = true;\n" +
    "    }\n" +
    "  }";
  if (src.indexOf(old429) !== -1) {
    src = src.replace(old429, new429);
    changed = true;
    console.log("[ensure-gemini-commercial] patched mapGeminiHttpError quota branch");
  }
}

if (src.indexOf("skipListingFallback") === -1 && src.indexOf("const searchError = mapGeminiHttpError") !== -1) {
  const needle =
    "if (first.res.status === 401 || first.res.status === 403) throw searchError;";
  const repl =
    "if (first.res.status === 401 || first.res.status === 403) throw searchError;\n" +
    '        if (searchError.code === "GEMINI_QUOTA_EXCEEDED") { skipListingFallback = true; throw searchError; }';
  if (src.indexOf(needle) !== -1) {
    src = src.replace(
      "let messageText = \"\";\n    let usedSearch = false;",
      "let messageText = \"\";\n    let usedSearch = false;\n    let skipListingFallback = false;"
    );
    src = src.replace(needle, repl);
    src = src.replace(
      'if (e && (e.code === "GEMINI_AUTH" || e.code === "NO_API_KEY")) throw e;',
      'if (e && (e.code === "GEMINI_AUTH" || e.code === "NO_API_KEY" || e.code === "GEMINI_QUOTA_EXCEEDED")) throw e;'
    );
    src = src.replace(
      "if (!messageText) {\n      const second = await callGemini",
      "if (!messageText && !skipListingFallback) {\n      const second = await callGemini"
    );
    changed = true;
    console.log("[ensure-gemini-commercial] patched quota skipListingFallback");
  }
}

const STRICT_MARKER = "Incomplete \"he preparado\"";
if (src.indexOf(STRICT_MARKER) === -1) {
  const start = src.indexOf("function claimsPreparedWebsite(text) {");
  const end = src.indexOf("\n}\n\nconst MARKET_LOCALES", start);
  if (start !== -1 && end !== -1) {
    const newClaims =
      "function claimsPreparedWebsite(text) {\n" +
      "  const t = String(text || \"\");\n" +
      "  // Require a website/site noun AND a clear prepared-claim binding it.\n" +
      "  // Incomplete \"he preparado\" / \"preparei\" / \"I have prepared\" alone must fail.\n" +
      "  if (!/\\b(website|site|sitio(\\s+web)?)\\b/i.test(t)) return false;\n" +
      "  const patterns = [\n" +
      "    /preparei\\s+((o|um|vosso|seu|su)\\s+)*(website|site|sitio)/i,\n" +
      "    /(website|site)\\s+(foi\\s+)?preparad/i,\n" +
      "    /(já\\s+)?tenho\\s+((um|o)\\s+)?(website|site)\\s+preparad/i,\n" +
      "    /(o\\s+)?(website|site)\\s+(já\\s+)?(está|esta)\\s+preparad/i,\n" +
      "    /site\\s+profissional\\s+(já\\s+)?preparad/i,\n" +
      "    /website\\s+profissional\\s+(já\\s+)?preparad/i,\n" +
      "    /preparei\\s+((um|o)\\s+)?(website|site)\\s+profissional/i,\n" +
      "    /he\\s+preparado\\s+((un|uno|el|vuestro|su)\\s+)*(sitio(\\s+web)?|website|site)\\b/i,\n" +
      "    /(ya\\s+)?tengo\\s+((un)\\s+)?(sitio(\\s+web)?|website|site)\\s+preparad/i,\n" +
      "    /(el\\s+)?(sitio(\\s+web)?|website)\\s+(ya\\s+)?(está|esta)\\s+preparad/i,\n" +
      "    /sitio\\s+(web\\s+)?(ya\\s+)?preparad/i,\n" +
      "    /I\\s+have\\s+prepared\\s+((a|an|the|your)\\s+)*(website|site)\\b/i,\n" +
      "    /we\\s+(have\\s+)?prepared\\s+((a|an|the|your)\\s+)*(website|site)\\b/i,\n" +
      "    /prepared\\s+((a|an|the|your)\\s+)*(website|site)\\b/i,\n" +
      "    /(the\\s+)?(website|site)\\s+(has\\s+been|is|was)\\s+(prepared|ready)\\b/i,\n" +
      "    /(website|site)\\s+is\\s+ready\\b/i\n" +
      "  ];\n" +
      "  for (let i = 0; i < patterns.length; i++) {\n" +
      "    if (patterns[i].test(t)) return true;\n" +
      "  }\n" +
      "  return false;\n" +
      "}";
    const afterBrace = end + "\n}".length;
    src = src.slice(0, start) + newClaims + src.slice(afterBrace);
    changed = true;
    console.log("[ensure-gemini-commercial] strict claimsPreparedWebsite applied");
  }
}

if (changed) {
  fs.writeFileSync(target, src);
  console.log("[ensure-gemini-commercial] wrote stability patches to lib/gemini-message.js");
} else if (
  src.indexOf("isQuotaExhaustedBody") !== -1 &&
  src.indexOf("work.then(cleanup, cleanup)") !== -1 &&
  src.indexOf(STRICT_MARKER) !== -1
) {
  console.log("[ensure-gemini-commercial] strategy + stability markers present — ok");
} else {
  console.log("[ensure-gemini-commercial] core present; optional patches already applied or pattern mismatch");
}
process.exit(0);
