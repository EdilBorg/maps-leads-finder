(function () {
  var DEFAULT_TEMPLATE =
    "Olá! Vi o {nome} em {cidade} e notei que ainda não têm website. Trabalho com sites simples e profissionais para negócios locais — posso enviar um exemplo sem compromisso?";
  var TEMPLATE_KEY = "maps_leads_msg_template";
  var COMMERCIAL_LOCALE_KEY = "maps_leads_commercial_locale_v1";

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
    var locale = typeof window.getCommercialLocale === "function" ? window.getCommercialLocale() : {};
    var text = getTemplate()
      .replace(/\{nome\}/gi, (lead && lead.name) || "")
      .replace(/\{cidade\}/gi, (lead && lead.city) || "")
      .replace(/\{morada\}/gi, (lead && lead.address) || "")
      .replace(/\{nicho\}/gi, niche)
      .replace(/\{categoria\}/gi, (lead && (lead.category || (lead.categories && lead.categories[0]))) || "")
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
    }, 1600);
  }

  window.prepareMessageForSend = function prepareMessageForSend(messagePayload) {
    return Promise.resolve(messagePayload);
  };

  window.copyLeadMessageFromBtn = function (btn) {
    var payload = window.buildLeadMessage(leadFromBtn(btn));
    window.prepareMessageForSend(payload).then(function (finalPayload) {
      var text = finalPayload.text || "";
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
  };

  window.openWhatsAppFromBtn = function (btn) {
    var wa = btn.getAttribute("data-wa") || "";
    var payload = window.buildLeadMessage(leadFromBtn(btn));
    window.prepareMessageForSend(payload).then(function (finalPayload) {
      var text = finalPayload.text || "";
      var url = "https://wa.me/" + wa + "?text=" + encodeURIComponent(text);
      window.open(url, "_blank", "noopener");
    });
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
