(function () {
  var DEFAULT_TEMPLATE =
    "Ol\u00e1! Vi o {nome} em {cidade} e notei que ainda n\u00e3o t\u00eam website. Trabalho com sites simples e profissionais para neg\u00f3cios locais \u2014 posso enviar um exemplo sem compromisso?";
  var TEMPLATE_KEY = "maps_leads_msg_template";

  function getTemplate() {
    try {
      var stored = localStorage.getItem(TEMPLATE_KEY);
      if (stored && stored.trim()) return stored;
    } catch (e) {}
    return DEFAULT_TEMPLATE;
  }

  function fillTemplate(lead) {
    var niche =
      (window.lastSearchMeta && window.lastSearchMeta.niche) ||
      (document.getElementById("niche") && document.getElementById("niche").value) ||
      "";
    return getTemplate()
      .replace(/\{nome\}/gi, lead.name || "")
      .replace(/\{cidade\}/gi, lead.city || "")
      .replace(/\{morada\}/gi, lead.address || "")
      .replace(/\{nicho\}/gi, niche);
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

  window.copyLeadMessageFromBtn = function (btn) {
    var text = fillTemplate({
      name: btn.getAttribute("data-name") || "",
      city: btn.getAttribute("data-city") || "",
      address: btn.getAttribute("data-address") || ""
    });
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("Mensagem copiada");
      }).catch(function () {
        alert(text);
      });
    } else {
      alert(text);
    }
  };

  window.openWhatsAppFromBtn = function (btn) {
    var wa = btn.getAttribute("data-wa") || "";
    var text = fillTemplate({
      name: btn.getAttribute("data-name") || "",
      city: btn.getAttribute("data-city") || "",
      address: btn.getAttribute("data-address") || ""
    });
    var url = "https://wa.me/" + wa + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank", "noopener");
  };
})();
