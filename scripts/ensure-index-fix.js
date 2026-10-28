"use strict";
const fs = require("fs");
const path = require("path");
const indexPath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf8");
if (html.includes("lastPipeline") && html.includes("pipeline: ")) {
  console.log("[ensure-index-fix] already applied");
} else {
let changed = false;

const oldSuccess =
  "        currentResults = data.results || [];\n" +
  "        lastSearchMeta = { niche, location, motor: data.motor || selectedMotor };\n" +
  "        window.currentResults = currentResults;\n" +
  "        window.lastSearchMeta = lastSearchMeta;\n" +
  "        if (typeof saveHistoryItem === \"function\") saveHistoryItem(lastSearchMeta, currentResults);\n" +
  "        renderResults(currentResults, niche, location, data.motor);\n" +
  "        document.getElementById(\"resultsSection\").classList.remove(\"hidden\");\n" +
  "        if (data.partial) {\n" +
  "          document.getElementById(\"errorState\").classList.add(\"show\");\n" +
  "          document.getElementById(\"errorMessage\").textContent =\n" +
  "            data.message || \"Pesquisa parcial: uma das fontes falhou; a mostrar resultados disponíveis.\";\n" +
  "          const hintEl = document.getElementById(\"errorHint\");\n" +
  "          if (hintEl) { hintEl.textContent = \"\"; hintEl.classList.add(\"hidden\"); }\n" +
  "        }";

const newSuccess =
  "        currentResults = data.results || [];\n" +
  "        lastSearchMeta = { niche, location, motor: data.motor || selectedMotor };\n" +
  "        window.currentResults = currentResults;\n" +
  "        window.lastSearchMeta = lastSearchMeta;\n" +
  "        window.lastPipeline = data.pipeline || null;\n" +
  "        if (typeof saveHistoryItem === \"function\") saveHistoryItem(lastSearchMeta, currentResults);\n" +
  "        renderResults(currentResults, niche, location, data.motor, data.pipeline || null);\n" +
  "        document.getElementById(\"resultsSection\").classList.remove(\"hidden\");\n" +
  "        if (data.partial || data.message) {\n" +
  "          document.getElementById(\"errorState\").classList.add(\"show\");\n" +
  "          document.getElementById(\"errorMessage\").textContent =\n" +
  "            data.message || \"Pesquisa parcial: uma das fontes falhou; a mostrar resultados disponíveis.\";\n" +
  "          const hintEl = document.getElementById(\"errorHint\");\n" +
  "          if (hintEl) { hintEl.textContent = \"\"; hintEl.classList.add(\"hidden\"); }\n" +
  "        } else {\n" +
  "          document.getElementById(\"errorState\").classList.remove(\"show\");\n" +
  "        }";

if (html.includes(oldSuccess)) {
  html = html.replace(oldSuccess, newSuccess);
  changed = true;
}

const oldRender =
  "    window.renderResults = function renderResults(results, niche, location, motorUsed) {\n" +
  "      const tbody = document.getElementById(\"resultsBody\");\n" +
  "      tbody.innerHTML = \"\";\n" +
  "      const motorLabel = motorUsed === \"apify\" ? \"Completa\" :\n" +
  "        (motorUsed === \"openstreetmap\" || motorUsed === \"osm\") ? \"Rápida\" :\n" +
  "        motorUsed === \"combined\" ? \"Automática (combinada)\" : \"\";\n" +
  "      document.getElementById(\"resultsCount\").textContent =\n" +
  "        results.length + \" empresas · \" + niche +\n" +
  "        (location ? \" em \" + location : \"\") +\n" +
  "        (motorLabel ? \" · \" + motorLabel : \"\");";

const newRender =
  "    window.renderResults = function renderResults(results, niche, location, motorUsed, pipeline) {\n" +
  "      const tbody = document.getElementById(\"resultsBody\");\n" +
  "      tbody.innerHTML = \"\";\n" +
  "      const motorLabel = motorUsed === \"apify\" ? \"Completa\" :\n" +
  "        (motorUsed === \"openstreetmap\" || motorUsed === \"osm\") ? \"Rápida\" :\n" +
  "        motorUsed === \"combined\" ? \"Automática (combinada)\" : \"\";\n" +
  "      let countLine =\n" +
  "        results.length + \" mostradas · \" + niche +\n" +
  "        (location ? \" em \" + location : \"\") +\n" +
  "        (motorLabel ? \" · \" + motorLabel : \"\");\n" +
  "      if (pipeline && typeof pipeline === \"object\") {\n" +
  "        const bits = [];\n" +
  "        if (pipeline.sourceRaw != null) bits.push(pipeline.sourceRaw + \" brutos\");\n" +
  "        if (pipeline.sourceNormalized != null) bits.push(pipeline.sourceNormalized + \" válidos\");\n" +
  "        if (pipeline.sourceWithWebsite != null) bits.push(pipeline.sourceWithWebsite + \" com site\");\n" +
  "        if (pipeline.sourceWithoutWebsite != null) bits.push(pipeline.sourceWithoutWebsite + \" sem site\");\n" +
  "        if (pipeline.dedupeRemoved != null && pipeline.dedupeRemoved > 0) bits.push(pipeline.dedupeRemoved + \" duplicados\");\n" +
  "        if (pipeline.afterOnlyNoWebsite != null && document.getElementById(\"onlyNoWebsite\") && document.getElementById(\"onlyNoWebsite\").checked)\n" +
  "          bits.push(pipeline.afterOnlyNoWebsite + \" após filtro sem site\");\n" +
  "        if (bits.length) countLine += \" · pipeline: \" + bits.join(\" → \");\n" +
  "      }\n" +
  "      document.getElementById(\"resultsCount\").textContent = countLine;";

if (html.includes(oldRender)) {
  html = html.replace(oldRender, newRender);
  changed = true;
}

if (changed) {
  fs.writeFileSync(indexPath, html);
  console.log("[ensure-index-fix] index.html updated");
} else {
  console.log("[ensure-index-fix] no matching blocks (already updated or unexpected HTML)");
}
}
