(function () {
  var MARKET_KEY = "maps_leads_msg_market";
  var busy = false;

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.className = "toast";
    document.body.appendChild(t);
    setTimeout(function () {
      t.remove();
    }, 1800);
  }

  function getStoredMarket() {
    try {
      return localStorage.getItem(MARKET_KEY) || "auto";
    } catch (e) {
      return "auto";
    }
  }

  function setStoredMarket(v) {
    try {
      localStorage.setItem(MARKET_KEY, v);
    } catch (e) {}
  }

  function leadFromBtn(btn) {
    var niche =
      (window.lastSearchMeta && window.lastSearchMeta.niche) ||
      (document.getElementById("niche") && document.getElementById("niche").value) ||
      "";
    var location =
      (window.lastSearchMeta && window.lastSearchMeta.location) ||
      (document.getElementById("location") && document.getElementById("location").value) ||
      "";
    return {
      name: btn.getAttribute("data-name") || "",
      city: btn.getAttribute("data-city") || "",
      address: btn.getAttribute("data-address") || "",
      phone: btn.getAttribute("data-phone") || "",
      wa: btn.getAttribute("data-wa") || "",
      category: btn.getAttribute("data-category") || "",
      website: btn.getAttribute("data-website") || "",
      rating: btn.getAttribute("data-rating") || "",
      reviews: btn.getAttribute("data-reviews") || "",
      niche: niche,
      location: location,
      hasWebsite: !!(btn.getAttribute("data-website") || "").trim()
    };
  }

  function ensureModal() {
    var existing = document.getElementById("msgComposeModal");
    if (existing) return existing;

    var wrap = document.createElement("div");
    wrap.id = "msgComposeModal";
    wrap.className = "msg-modal hidden";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "msgComposeTitle");
    wrap.innerHTML =
      '<div class="msg-modal-backdrop" data-close="1"></div>' +
      '<div class="msg-modal-card">' +
      '  <header class="msg-modal-head">' +
      '    <h2 id="msgComposeTitle">Mensagem comercial</h2>' +
      '    <button type="button" class="msg-modal-x" data-close="1" aria-label="Fechar">×</button>' +
      "  </header>" +
      '  <p class="msg-modal-sub" id="msgComposeCompany"></p>' +
      '  <div class="msg-field">' +
      '    <label for="msgMarket">Mercado / idioma</label>' +
      '    <select id="msgMarket">' +
      '      <option value="auto">Automático (pela localização)</option>' +
      '      <option value="pt-PT">Portugal (português europeu)</option>' +
      '      <option value="es-ES">Espanha (espanhol)</option>' +
      '      <option value="en">Inglês</option>' +
      "    </select>" +
      "  </div>" +
      '  <div class="msg-field">' +
      '    <label for="msgText">Mensagem</label>' +
      '    <textarea id="msgText" rows="7" placeholder="A mensagem gerada aparece aqui. Podes editar antes de copiar ou abrir o WhatsApp."></textarea>' +
      "  </div>" +
      '  <p class="msg-status" id="msgStatus" aria-live="polite"></p>' +
      '  <div class="msg-sources hidden" id="msgSources"></div>' +
      '  <div class="msg-actions">' +
      '    <button type="button" class="btn-ghost" id="msgRegenBtn">Gerar novamente</button>' +
      '    <button type="button" class="btn-ghost" id="msgCopyBtn">Copiar</button>' +
      '    <button type="button" class="btn-primary" id="msgWaBtn">Abrir WhatsApp</button>' +
      "  </div>" +
      "</div>";
    document.body.appendChild(wrap);

    wrap.addEventListener("click", function (e) {
      if (e.target && e.target.getAttribute("data-close") === "1") closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !wrap.classList.contains("hidden")) closeModal();
    });
    document.getElementById("msgMarket").addEventListener("change", function () {
      setStoredMarket(document.getElementById("msgMarket").value);
    });
    document.getElementById("msgRegenBtn").addEventListener("click", function () {
      if (wrap._lead) generateForLead(wrap._lead, true);
    });
    document.getElementById("msgCopyBtn").addEventListener("click", function () {
      var text = document.getElementById("msgText").value || "";
      if (!text.trim()) return toast("Ainda não há mensagem");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          toast("Mensagem copiada");
        }).catch(function () {
          alert(text);
        });
      } else {
        alert(text);
      }
    });
    document.getElementById("msgWaBtn").addEventListener("click", function () {
      var text = document.getElementById("msgText").value || "";
      var wa = (wrap._lead && wrap._lead.wa) || "";
      if (!text.trim()) return toast("Gera ou escreve uma mensagem primeiro");
      if (!wa) return toast("Este lead não tem telefone para WhatsApp");
      var url = "https://wa.me/" + wa + "?text=" + encodeURIComponent(text);
      window.open(url, "_blank", "noopener");
    });
    return wrap;
  }

  function closeModal() {
    var m = document.getElementById("msgComposeModal");
    if (m) m.classList.add("hidden");
  }

  function openModal(lead) {
    var m = ensureModal();
    m._lead = lead;
    document.getElementById("msgComposeCompany").textContent = lead.name || "Empresa";
    document.getElementById("msgMarket").value = getStoredMarket();
    document.getElementById("msgText").value = "";
    document.getElementById("msgStatus").textContent = "";
    var srcEl = document.getElementById("msgSources");
    if (srcEl) { srcEl.innerHTML = ""; srcEl.classList.add("hidden"); }
    document.getElementById("msgWaBtn").style.display = lead.wa ? "" : "none";
    m.classList.remove("hidden");
    document.getElementById("msgMarket").focus();
  }

  function setLoading(on) {
    busy = !!on;
    var status = document.getElementById("msgStatus");
    var regen = document.getElementById("msgRegenBtn");
    if (status) status.textContent = on ? "A gerar mensagem…" : status.textContent;
    if (regen) regen.disabled = !!on;
  }

  function generateForLead(lead, fromRegen) {
    if (busy) return;
    setLoading(true);
    var status = document.getElementById("msgStatus");
    if (status) status.textContent = "A gerar mensagem…";
    var market = (document.getElementById("msgMarket") && document.getElementById("msgMarket").value) || "auto";
    setStoredMarket(market);

    var payload = {
      name: lead.name,
      city: lead.city,
      address: lead.address,
      category: lead.category,
      niche: lead.niche,
      location: lead.location,
      website: lead.website,
      hasWebsite: !!lead.hasWebsite,
      rating: lead.rating ? Number(lead.rating) : null,
      reviews: lead.reviews ? Number(lead.reviews) : null,
      market: market
    };

    fetch("/api/messages/generate", {
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
        }
        document.getElementById("msgText").value = data.message;
        if (status) {
          var bits = [fromRegen ? "Nova mensagem gerada." : "Mensagem gerada. Podes editar antes de enviar."];
          if (data.searchFallback) bits.push("Pesquisa web limitada — baseada nos dados da listagem.");
          else if (data.researchMode === "grounded") bits.push("Com pesquisa web.");
          if (data.cached) bits.push("(cache)");
          status.textContent = bits.join(" ");
        }
        var srcBox = document.getElementById("msgSources");
        if (srcBox) {
          srcBox.innerHTML = "";
          if (data.sources && data.sources.length) {
            var lab = document.createElement("div");
            lab.className = "msg-sources-label";
            lab.textContent = "Fontes consultadas (pesquisa web)";
            srcBox.appendChild(lab);
            data.sources.forEach(function (s) {
              if (!s || !s.url) return;
              var a = document.createElement("a");
              a.href = s.url;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.textContent = s.title || s.url;
              srcBox.appendChild(a);
            });
            srcBox.classList.remove("hidden");
          } else {
            srcBox.classList.add("hidden");
          }
        }
      })
      .catch(function (err) {
        if (status) status.textContent = err.message || "Erro ao gerar mensagem.";
        toast(err.message || "Erro ao gerar mensagem");
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function openCompose(btn) {
    var lead = leadFromBtn(btn);
    if (!lead.name) {
      toast("Dados do lead em falta");
      return;
    }
    openModal(lead);
    generateForLead(lead, false);
  }

  window.copyLeadMessageFromBtn = function (btn) {
    openCompose(btn);
  };

  window.openWhatsAppFromBtn = function (btn) {
    openCompose(btn);
  };
})();
