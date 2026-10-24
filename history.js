(function () {
  const HISTORY_KEY = "maps_leads_history_v1";
  function modeLabel(m) {
    if (m === "apify") return "Completa";
    if (m === "outscraper") return "R\u00e1pida";
    if (m === "auto") return "Autom\u00e1tica";
    return m || "";
  }
  const HISTORY_MAX = 20;

  window.loadHistory = function () {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch (e) { return []; }
  };

  window.saveHistoryItem = function (meta, results) {
    if (!results || !results.length) return;
    const list = window.loadHistory().filter(h =>
      !(h.niche === meta.niche && h.location === meta.location && h.motor === meta.motor)
    );
    list.unshift({
      id: Date.now().toString(36),
      niche: meta.niche || "",
      location: meta.location || "",
      motor: meta.motor || "",
      total: results.length,
      at: new Date().toISOString(),
      results: results
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    window.renderHistory();
  };

  window.renderHistory = function () {
    const list = window.loadHistory();
    const section = document.getElementById("historySection");
    const box = document.getElementById("historyList");
    if (!section || !box) return;
    if (!list.length) {
      section.classList.add("hidden");
      return;
    }
    section.classList.remove("hidden");
    const esc = (typeof window.escapeHtml === "function")
      ? window.escapeHtml
      : function (t) {
          if (!t) return "";
          const d = document.createElement("div");
          d.textContent = t;
          return d.innerHTML;
        };
    box.innerHTML = list.map(h => {
      const label = (h.niche || "\u2014") + (h.location ? " \u00b7 " + h.location : "");
      const when = h.at
        ? new Date(h.at).toLocaleString("pt-PT", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
          })
        : "";
      return (
        '<button type="button" class="history-item" data-id="' + h.id +
        '" onclick="openHistory(this.getAttribute(\'data-id\'))">' +
        '<div class="t">' + esc(label) + "</div>" +
        '<div class="m">' + h.total + " leads \u00b7 " + esc(modeLabel(h.motor)) + " \u00b7 " + when + "</div>" +
        "</button>"
      );
    }).join("");
  };

  window.openHistory = function (id) {
    const item = window.loadHistory().find(h => h.id === id);
    if (!item) return;
    window.currentResults = item.results || [];
    window.lastSearchMeta = {
      niche: item.niche,
      location: item.location,
      motor: item.motor
    };
    const nicheEl = document.getElementById("niche");
    const locEl = document.getElementById("location");
    if (nicheEl) nicheEl.value = item.niche || "";
    if (locEl) locEl.value = item.location || "";
    const err = document.getElementById("errorState");
    if (err) err.classList.remove("show");
    if (typeof window.renderResults === "function") {
      window.renderResults(window.currentResults, item.niche, item.location, item.motor);
    }
    const rs = document.getElementById("resultsSection");
    if (rs) rs.classList.remove("hidden");
    const count = document.getElementById("resultsCount");
    if (count) {
      count.textContent =
        window.currentResults.length +
        " empresas (hist\u00f3rico) \u00b7 " +
        item.niche +
        (item.location ? " em " + item.location : "");
    }
  };

  window.clearHistory = function () {
    if (!confirm("Apagar todo o hist\u00f3rico local?")) return;
    localStorage.removeItem(HISTORY_KEY);
    window.renderHistory();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.renderHistory();
    });
  } else {
    setTimeout(function () {
      window.renderHistory();
    }, 0);
  }
})();
