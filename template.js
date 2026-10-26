(function () {
  var DEFAULT_TEMPLATE =
    "Olá! Vi o {nome} em {cidade} e notei que ainda não têm website. Trabalho com sites simples e profissionais para negócios locais — posso enviar um exemplo sem compromisso?";
  var TEMPLATE_KEY = "maps_leads_msg_template";
  var COMMERCIAL_LOCALE_KEY = "maps_leads_commercial_locale_v1";
  var busy = false;

  function getTemplate() {
    try {
      var stored = localStorage.getItem(TEMPLATE_KEY);
      if (stored && stored.trim()) return stored;
    } catch (e) {}
    return DEFAULT_TEMPLATE;
  }

  window.getCommercialLocale = function getCommercialLocale() {
    try {
      var raw = localStorage.getItem(COMMERCIAL_LOCALE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return {
            countryCode: parsed.countryCode || "",
            language: parsed.language || ""
          };
        }
      }
    } catch (e) {}
    var countryEl = document.getElementById("commercialCountry");
    var langEl = document.getElementById("commercialLanguage");
    return {
      countryCode: countryEl ? countryEl.value || "" : "",
      language: langEl ? langEl.value || "" : ""
    };
  };

  window.setCommercialLocale = function setCommercialLocale(countryCode, language) {
    var payload = {
      countryCode: countryCode || "",
      language: language || ""
    };
    try {
      localStorage.setItem(COMMERCIAL_LOCALE_KEY, JSON.stringify(payload));
    } catch (e) {}
    var countryEl = document.getElementById("commercialCountry");
    var langEl = document.getElementById("commercialLanguage");
    if (countryEl && countryCode != null) countryEl.value = countryCode;
    if (langEl && language != null) langEl.value = language;
  };

  window.buildLeadMessage = function buildLeadMessage(lead) {
    var niche =
      (window.lastSearchMeta && window.lastSearchMeta.niche) ||
      (document.getElementById("niche") && document.getElementById("niche").value) ||
      "";
    var locale =
      typeof window.getCommercialLocale === "function" ? window.getCommercialLocale() : {};
    var text = getTemplate()
      .replace(/\{nome\}/gi, (lead && lead.name) || "")
      .replace(/\{cidade\}/gi, (lead && lead.city) || "")
      .replace(/\{morada\}/gi, (lead && lead.address) || "")
      .replace(/\{nicho\}/gi, niche)
      .replace(
        /\{categoria\}/gi,
        (lead && (lead.category || (lead.categories && lead.categories[0]))) || ""
      )
      .replace(/\{telefone\}/gi, (lead && lead.phone) || "");
    return {
      text: text,
      lead: lead || {},
      commercialLocale: locale,
      source: "template",
      editable: true
    };
  };

  function leadFromBtn(btn) {
    return {
      name: btn.getAttribute("data-name") || "",
      city: btn.getAttribute("data-city") || "",
      address: btn.getAttribute("data-address") || "",
      phone: btn.getAttribute("data-phone") || "",
      category: btn.getAttribute("data-category") || "",
      countryCode: btn.getAttribute("data-country") || "",
      website: btn.getAttribute("data-website") || "",
      rating: btn.getAttribute("data-rating") || "",
      reviews: btn.getAttribute("data-reviews") || "",
      googlePlaceId: btn.getAttribute("data-google-place-id") || "",
      googleMapsUrl: btn.getAttribute("data-google-maps-url") || "",
      osmId: btn.getAttribute("data-osm-id") || "",
      sources: (btn.getAttribute("data-sources") || "").split(",").filter(Boolean)
    };
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.className = "toast";
    document.body.appendChild(t);
    setTimeout(function () {
      t.remove();
    }, 1800);
  }

  function setBtnState(btn, state) {
    if (!btn) return;
    if (!btn.getAttribute("data-label-orig")) {
      btn.setAttribute("data-label-orig", btn.textContent || "");
    }
    var orig = btn.getAttribute("data-label-orig");
    if (state === "loading") {
      btn.disabled = true;
      btn.textContent = "…";
    } else {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  window.prepareMessageForSend = function prepareMessageForSend(messagePayload, opts) {
    opts = opts || {};
    var lead = (messagePayload && messagePayload.lead) || {};
    var locale =
      (messagePayload && messagePayload.commercialLocale) ||
      (typeof window.getCommercialLocale === "function" ? window.getCommercialLocale() : {});
    var body = {
      lead: lead,
      commercialCountry: locale.countryCode || "",
      language: locale.language || "",
      forceRefresh: !!opts.forceRefresh
    };
    return fetch("/api/message/prepare", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res
          .json()
          .then(function (data) {
            return { res: res, data: data };
          })
          .catch(function () {
            return { res: res, data: null };
          });
      })
      .then(function (pair) {
        if (pair.res.ok && pair.data && pair.data.success && pair.data.text) {
          return {
            text: pair.data.text,
            lead: lead,
            commercialLocale: locale,
            source: pair.data.source || "api",
            cached: !!pair.data.cached,
            warning: pair.data.warning || null,
            editable: true
          };
        }
        var local = window.buildLeadMessage(lead);
        var errMsg =
          (pair.data && (pair.data.error || (pair.data.warning && pair.data.warning.error))) ||
          (pair.res && pair.res.status === 429
            ? "Demasiados pedidos. Espera um minuto."
            : pair.res && pair.res.status === 401
              ? "Sessão expirada. Volta a autenticar."
              : "Falha na geração; mensagem local.");
        local.warning = errMsg;
        local.source = "template";
        return local;
      })
      .catch(function () {
        var local = window.buildLeadMessage(lead);
        local.warning = "Rede indisponível; mensagem local.";
        local.source = "template";
        return local;
      });
  };

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          toast("Mensagem copiada");
        },
        function () {
          window.prompt("Copia a mensagem:", text);
        }
      );
    }
    window.prompt("Copia a mensagem:", text);
    return Promise.resolve();
  }

  window.copyLeadMessageFromBtn = function (btn) {
    if (busy) return;
    busy = true;
    setBtnState(btn, "loading");
    var lead = leadFromBtn(btn);
    var base = window.buildLeadMessage(lead);
    window
      .prepareMessageForSend(base, { forceRefresh: false })
      .then(function (finalPayload) {
        return copyText(finalPayload.text || "").then(function () {
          if (finalPayload.warning) {
            toast(
              typeof finalPayload.warning === "string"
                ? finalPayload.warning
                : finalPayload.warning.error || "Aviso na geração"
            );
          }
        });
      })
      .catch(function () {
        toast("Erro ao preparar mensagem");
      })
      .finally(function () {
        busy = false;
        setBtnState(btn, "idle");
      });
  };

  function ensureWaModal() {
    var el = document.getElementById("waPreviewModal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "waPreviewModal";
    el.className = "wa-modal hidden";
    el.setAttribute("role", "presentation");
    el.innerHTML =
      '<div class="wa-modal-backdrop" data-close="1"></div>' +
      '<div class="wa-modal-card" role="dialog" aria-modal="true" aria-labelledby="waPreviewTitle">' +
      '<h3 id="waPreviewTitle">Pré-visualizar mensagem</h3>' +
      '<p class="wa-modal-hint">Revê e edita o texto antes de abrir o WhatsApp. Nada é enviado automaticamente.</p>' +
      '<textarea id="waPreviewText" rows="8" aria-label="Texto da mensagem"></textarea>' +
      '<div class="wa-modal-actions">' +
      '<button type="button" class="btn-ghost" id="waPreviewCancel">Cancelar</button>' +
      '<button type="button" class="btn-ghost" id="waPreviewRetry">Nova análise</button>' +
      '<button type="button" class="btn-primary" id="waPreviewOpen">Abrir WhatsApp</button>' +
      "</div></div>";
    document.body.appendChild(el);
    el.querySelector("[data-close]").addEventListener("click", function () {
      el.classList.add("hidden");
    });
    el.querySelector("#waPreviewCancel").addEventListener("click", function () {
      el.classList.add("hidden");
    });
    return el;
  }

  window.openWhatsAppFromBtn = function (btn) {
    if (busy) return;
    busy = true;
    setBtnState(btn, "loading");
    var wa = (btn.getAttribute("data-wa") || "").replace(/\D/g, "");
    var lead = leadFromBtn(btn);
    var base = window.buildLeadMessage(lead);
    var modal = ensureWaModal();
    var ta = modal.querySelector("#waPreviewText");
    var openBtn = modal.querySelector("#waPreviewOpen");
    var retryBtn = modal.querySelector("#waPreviewRetry");

    function show(text) {
      ta.value = text || "";
      modal.classList.remove("hidden");
    }

    function run(force) {
      return window.prepareMessageForSend(base, { forceRefresh: !!force }).then(function (finalPayload) {
        show(finalPayload.text || "");
        if (finalPayload.warning) {
          toast(
            typeof finalPayload.warning === "string"
              ? finalPayload.warning
              : finalPayload.warning.error || "Aviso na geração"
          );
        }
        return finalPayload;
      });
    }

    run(false)
      .catch(function () {
        show(base.text || "");
        toast("Erro na geração; texto local");
      })
      .finally(function () {
        busy = false;
        setBtnState(btn, "idle");
      });

    openBtn.onclick = function () {
      var text = ta.value || "";
      if (!wa) {
        toast("Número WhatsApp em falta");
        return;
      }
      var url = "https://wa.me/" + wa + "?text=" + encodeURIComponent(text);
      window.open(url, "_blank", "noopener");
      modal.classList.add("hidden");
    };
    retryBtn.onclick = function () {
      retryBtn.disabled = true;
      run(true).finally(function () {
        retryBtn.disabled = false;
      });
    };
  };

  function bindCommercialLocaleControls() {
    var countryEl = document.getElementById("commercialCountry");
    var langEl = document.getElementById("commercialLanguage");
    if (!countryEl && !langEl) return;
    try {
      var stored = JSON.parse(localStorage.getItem(COMMERCIAL_LOCALE_KEY) || "{}");
      if (countryEl && stored.countryCode) countryEl.value = stored.countryCode;
      if (langEl && stored.language) langEl.value = stored.language;
    } catch (e) {}
    function persist() {
      window.setCommercialLocale(
        countryEl ? countryEl.value : "",
        langEl ? langEl.value : ""
      );
    }
    if (countryEl) countryEl.addEventListener("change", persist);
    if (langEl) langEl.addEventListener("change", persist);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindCommercialLocaleControls);
  } else {
    bindCommercialLocaleControls();
  }
})();
