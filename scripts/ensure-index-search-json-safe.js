"use strict";
const fs = require("fs");
const path = require("path");
const indexPath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf8");
if (html.includes("async function parseApiJson") && html.includes('Accept: "application/json"')) {
  console.log("[ensure-index-search-json-safe] already applied");
  process.exit(0);
}

const helper = `
    async function parseApiJson(res) {
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      const text = await res.text();
      const sample = (text || "").replace(/\\s+/g, " ").trim().slice(0, 120);
      let data = null;
      const looksJson = ctype.indexOf("application/json") !== -1 || (text && (text.charAt(0) === "{" || text.charAt(0) === "["));
      if (looksJson) {
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      }
      if (!data) {
        if (res.status === 401 || res.status === 403) {
          window.location.replace("/login");
          return { aborted: true, data: null, res: res };
        }
        const hint = sample ? (" Resposta: " + sample) : "";
        if (res.status === 404) throw new Error("Serviço de pesquisa não encontrado (HTTP 404)." + hint);
        if (res.status === 502 || res.status === 503) throw new Error("Servidor ou proxy indisponível (HTTP " + res.status + "). Tenta novamente.");
        if (res.status >= 500) throw new Error("Erro interno do servidor (HTTP " + res.status + ").");
        if (!res.ok) throw new Error("Não foi possível concluir a pesquisa (HTTP " + res.status + ")." + hint);
        throw new Error("Resposta inválida do servidor (não JSON). Actualiza a página e tenta de novo.");
      }
      return { aborted: false, data: data, res: res };
    }

`;

const needle = "    window.lastSearchMeta = lastSearchMeta;\n";
if (!html.includes(needle)) {
  console.error("[ensure-index-search-json-safe] anchor not found");
  process.exit(1);
}
if (!html.includes("async function parseApiJson")) {
  html = html.replace(needle, needle + helper);
}

const oldFetch = `        const res = await fetch("/api/search", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            niche, location, motor: selectedMotor,
            onlyNoWebsite: document.getElementById("onlyNoWebsite").checked,
            maxResults: parseInt(document.getElementById("maxResults").value, 10),
            minRating: parseFloat(document.getElementById("minRating").value) || 0,
            minReviews: parseInt(document.getElementById("minReviews").value, 10) || 0
          })
        });
        const data = await res.json();
        if (res.status === 401) {
          window.location.replace("/login");
          return;
        }`;

const newFetch = `        const res = await fetch("/api/search", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            niche, location, motor: selectedMotor,
            onlyNoWebsite: document.getElementById("onlyNoWebsite").checked,
            maxResults: parseInt(document.getElementById("maxResults").value, 10),
            minRating: parseFloat(document.getElementById("minRating").value) || 0,
            minReviews: parseInt(document.getElementById("minReviews").value, 10) || 0
          })
        });
        const parsed = await parseApiJson(res);
        if (parsed.aborted) return;
        const data = parsed.data;
        if (res.status === 401) {
          window.location.replace("/login");
          return;
        }`;

if (html.includes(oldFetch)) {
  html = html.replace(oldFetch, newFetch);
} else if (!html.includes("parseApiJson(res)")) {
  console.error("[ensure-index-search-json-safe] search fetch block not found");
  process.exit(1);
}

const oldStatus = `        const res = await fetch("/api/status", { credentials: "same-origin" });
        const data = await res.json();`;
const newStatus = `        const res = await fetch("/api/status", { credentials: "same-origin", headers: { Accept: "application/json" } });
        const parsed = await parseApiJson(res);
        if (parsed.aborted) return;
        const data = parsed.data;`;
if (html.includes(oldStatus)) html = html.replace(oldStatus, newStatus);

fs.writeFileSync(indexPath, html);
console.log("[ensure-index-search-json-safe] index.html updated");
