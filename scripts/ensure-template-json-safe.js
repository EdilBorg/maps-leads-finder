"use strict";
/**
 * Idempotent: make template.js parse API responses safely (avoid Unexpected token '<' on HTML).
 */
const fs = require("fs");
const path = require("path");
const templatePath = path.join(__dirname, "..", "template.js");
let src = fs.readFileSync(templatePath, "utf8");

if (src.includes("looksJson") && src.includes("Resposta inválida do servidor")) {
  console.log("[ensure-template-json-safe] already applied");
  process.exit(0);
}

const old = `    fetch("/api/messages/generate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { res: res, data: data };
        });
      })
      .then(function (_ref) {
        var res = _ref.res;
        var data = _ref.data;
        if (res.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (!res.ok || !data.success || !data.message) {
          throw new Error((data && data.error) || "Não foi possível gerar a mensagem.");
        }`;

const neu = `    fetch("/api/messages/generate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        var ctype = (res.headers.get("content-type") || "").toLowerCase();
        return res.text().then(function (text) {
          var data = null;
          var looksJson = ctype.indexOf("application/json") !== -1 || (text && text.charAt(0) === "{");
          if (looksJson) {
            try {
              data = text ? JSON.parse(text) : null;
            } catch (parseErr) {
              data = null;
            }
          }
          if (!data) {
            if (res.status === 401 || res.status === 403) {
              window.location.replace("/login");
              return { res: res, data: null, aborted: true };
            }
            if (res.status === 404) {
              throw new Error("A geração de mensagens não está disponível neste servidor (rota em falta).");
            }
            if (res.status >= 500) {
              throw new Error("O servidor não respondeu correctamente. Tenta novamente dentro de momentos.");
            }
            throw new Error("Resposta inválida do servidor (não JSON). Actualiza a página e tenta de novo.");
          }
          return { res: res, data: data, aborted: false };
        });
      })
      .then(function (_ref) {
        if (!_ref || _ref.aborted) return;
        var res = _ref.res;
        var data = _ref.data;
        if (res.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (!res.ok || !data.success || !data.message) {
          var code = data && data.code ? String(data.code) : "";
          var msg = (data && data.error) || "Não foi possível gerar a mensagem.";
          if (code === "GEMINI_RATE_LIMIT") {
            msg = data.error || "Limite de pedidos do Gemini atingido. Espera um momento e tenta de novo.";
          } else if (code === "NO_API_KEY" || code === "GEMINI_AUTH") {
            msg = data.error || "A geração de mensagens não está configurada correctamente.";
          }
          throw new Error(msg);
        }`;

if (!src.includes(old)) {
  console.error("[ensure-template-json-safe] expected fetch block not found — template.js may have changed");
  process.exit(1);
}
src = src.replace(old, neu);
fs.writeFileSync(templatePath, src);
console.log("[ensure-template-json-safe] template.js updated");
