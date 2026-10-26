"use strict";

/**
 * Search constants and OSM/Apify helper functions.
 * Required by place-model / place-normalize / search-engines.
 */
module.exports = function createPlaceConstants(deps) {
  const { fetch } = deps;

  const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || "";
  const OVERPASS_URL = process.env.OVERPASS_URL || "";
  const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
  const OVERPASS_ENDPOINTS = OVERPASS_URL
    ? [OVERPASS_URL]
    : [
        "https://overpass-api.de/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
      ];

  function hasApify() {
    return !!(APIFY_API_TOKEN && !APIFY_API_TOKEN.includes("colocar_"));
  }

  function hasOsm() {
    return true;
  }

  function friendlyError(err, motor) {
    const raw = err && err.message ? String(err.message) : String(err);
    const lower = raw.toLowerCase();
    console.error("[search error]", motor || "-", raw.slice(0, 500));
    if (
      lower.includes("não configurada") ||
      lower.includes("não configurado") ||
      lower.includes("colocar_")
    ) {
      return {
        code: "NO_API_KEY",
        error: "O serviço de pesquisa não está disponível de momento. Tenta novamente mais tarde.",
        hint: null
      };
    }
    if (
      lower.includes("401") ||
      lower.includes("unauthorized") ||
      lower.includes("invalid api") ||
      lower.includes("authentication")
    ) {
      return {
        code: "INVALID_KEY",
        error: "Não foi possível autenticar o serviço de pesquisa. Tenta novamente mais tarde.",
        hint: null
      };
    }
    if (
      lower.includes("402") ||
      lower.includes("payment") ||
      lower.includes("quota") ||
      lower.includes("limit exceeded") ||
      lower.includes("insufficient")
    ) {
      return {
        code: "QUOTA",
        error: "O limite de pesquisas foi atingido. Tenta novamente mais tarde ou reduz o número de resultados.",
        hint: null
      };
    }
    if (
      lower.includes("429") ||
      lower.includes("rate limit") ||
      lower.includes("too many") ||
      lower.includes("bandwidth")
    ) {
      return {
        code: "RATE_LIMIT",
        error: "Demasiados pedidos em pouco tempo. Espera um minuto e tenta de novo.",
        hint: null
      };
    }
    if (
      lower.includes("timeout") ||
      lower.includes("aborted") ||
      lower.includes("timed out") ||
      lower.includes("gateway timeout")
    ) {
      return {
        code: "TIMEOUT",
        error: "A pesquisa demorou demasiado. Reduz o máximo de resultados ou escolhe uma zona mais pequena.",
        hint: null
      };
    }
    if (
      lower.includes("network") ||
      lower.includes("fetch failed") ||
      lower.includes("econnrefused") ||
      lower.includes("enotfound")
    ) {
      return {
        code: "NETWORK",
        error: "Não foi possível ligar ao serviço de pesquisa. Verifica a ligação e tenta de novo.",
        hint: null
      };
    }
    if (
      lower.includes("status: failed") ||
      lower.includes("terminou com status") ||
      lower.includes("sem resultados de localização")
    ) {
      return {
        code: "RUN_FAILED",
        error: "Não foi possível concluir a pesquisa. Tenta novamente ou escolhe outra localização.",
        hint: null
      };
    }
    return {
      code: "UNKNOWN",
      error: "Não foi possível concluir a pesquisa. Tenta novamente.",
      hint: null
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extractCity(address) {
    if (!address) return "";
    const parts = String(address).split(",");
    return parts.length > 1 ? parts[parts.length - 2].trim() : "";
  }

  function escapeOverpassRegex(str) {
    return String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function osmTagClauses(niche) {
    const n = (niche || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const tags = [];
    const map = [
      [/cabeleireir|barbeari|hair/, ['["shop"="hairdresser"]', '["craft"="hairdresser"]', '["shop"="beauty"]']],
      [/restaurante|restaurant/, ['["amenity"="restaurant"]']],
      [/cafe|cafeteria|pastelaria/, ['["amenity"="cafe"]', '["shop"="bakery"]']],
      [/oficina|mecanico|auto\s*repair|carro/, ['["shop"="car_repair"]', '["shop"="car"]']],
      [/farmacia/, ['["amenity"="pharmacy"]']],
      [/hotel|alojamento|hostel/, ['["tourism"="hotel"]', '["tourism"="hostel"]', '["tourism"="guest_house"]']],
      [/ginasio|gym|fitness/, ['["leisure"="fitness_centre"]', '["leisure"="sports_centre"]']],
      [/dentista|dental/, ['["amenity"="dentist"]']],
      [/advogad|juridic|lawyer/, ['["office"="lawyer"]']],
      [/contabil|accountant/, ['["office"="accountant"]']],
      [/veterinar/, ['["amenity"="veterinary"]']],
      [/padaria|bakery/, ['["shop"="bakery"]']],
      [/supermercado|mercearia/, ['["shop"="supermarket"]', '["shop"="convenience"]']],
      [/florista|flor/, ['["shop"="florist"]']],
      [/roupa|boutique|vestuario/, ['["shop"="clothes"]']],
      [/eletronic|telemovel|phone/, ['["shop"="electronics"]', '["shop"="mobile_phone"]']],
      [/escola|academy|formacao/, ['["amenity"="school"]', '["amenity"="college"]']],
      [/clinica|medico|saude/, ['["amenity"="clinic"]', '["amenity"="doctors"]']]
    ];
    for (const [re, list] of map) {
      if (re.test(n)) tags.push(...list);
    }
    return [...new Set(tags)];
  }

  async function geocodeLocation(location) {
    const q = (location || "").trim() || "Portugal";
    const url = NOMINATIM_URL + "?format=json&limit=1&addressdetails=0&q=" + encodeURIComponent(q);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "MapsLeadsFinder/1.0 (local research tool)",
          Accept: "application/json"
        },
        signal: controller.signal
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Nominatim erro ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) {
        throw new Error("Sem resultados de localização para: " + q);
      }
      const item = data[0];
      const bb = item.boundingbox;
      if (!bb || bb.length < 4) {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        const d = 0.08;
        return {
          south: lat - d,
          north: lat + d,
          west: lon - d,
          east: lon + d,
          display: item.display_name || q
        };
      }
      return {
        south: parseFloat(bb[0]),
        north: parseFloat(bb[1]),
        west: parseFloat(bb[2]),
        east: parseFloat(bb[3]),
        display: item.display_name || q
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function buildOverpassQuery(niche, bbox, limit) {
    const { south, north, west, east } = bbox;
    const bboxStr = `${south},${west},${north},${east}`;
    const nameRe = escapeOverpassRegex(niche.trim());
    const tagClauses = osmTagClauses(niche);
    const parts = [];
    parts.push(`nwr["name"~"${nameRe}",i](${bboxStr});`);
    for (const t of tagClauses) {
      parts.push(`nwr${t}(${bboxStr});`);
    }
    if (!tagClauses.length && niche.trim()) {
      parts.push(`nwr["shop"]["name"~"${nameRe}",i](${bboxStr});`);
      parts.push(`nwr["amenity"]["name"~"${nameRe}",i](${bboxStr});`);
      parts.push(`nwr["craft"]["name"~"${nameRe}",i](${bboxStr});`);
      parts.push(`nwr["office"]["name"~"${nameRe}",i](${bboxStr});`);
      parts.push(`nwr["tourism"]["name"~"${nameRe}",i](${bboxStr});`);
    }
    const outLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return `[out:json][timeout:45];\n(\n  ${parts.join("\n  ")}\n);\nout center ${outLimit};`;
  }

  function isOfficialWebsite(value) {
    if (value == null) return false;
    const v = String(value).trim().toLowerCase();
    if (!v || v === "null" || v === "undefined" || v === "-" || v === "n/a" || v === "none") return false;
    if (
      /google\.(com|pt).*maps|maps\.google|goo\.gl\/maps|openstreetmap\.org|osm\.org|maps\.app\.goo/i.test(
        v
      )
    )
      return false;
    return true;
  }

  function osmWebsiteFromTags(tags) {
    if (!tags) return "";
    for (const c of [
      tags.website,
      tags["contact:website"],
      tags.url,
      tags["contact:url"],
      tags["website:pt"]
    ]) {
      if (isOfficialWebsite(c)) return String(c).trim();
    }
    return "";
  }

  function osmPhoneFromTags(tags) {
    if (!tags) return "";
    return (tags.phone || tags["contact:phone"] || tags["contact:mobile"] || tags.mobile || "").trim();
  }

  function osmEmailFromTags(tags) {
    if (!tags) return "";
    return (tags.email || tags["contact:email"] || "").trim();
  }

  function osmOpeningHours(tags) {
    if (!tags) return "";
    return (tags.opening_hours || tags["contact:opening_hours"] || "").trim();
  }

  function osmCategories(tags) {
    if (!tags) return [];
    const cats = [];
    if (tags.shop) cats.push("shop:" + tags.shop);
    if (tags.amenity) cats.push("amenity:" + tags.amenity);
    if (tags.office) cats.push("office:" + tags.office);
    if (tags.craft) cats.push("craft:" + tags.craft);
    if (tags.tourism) cats.push("tourism:" + tags.tourism);
    if (tags.leisure) cats.push("leisure:" + tags.leisure);
    return cats;
  }

  function osmStreet(tags) {
    if (!tags) return "";
    return [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ").trim();
  }

  function osmFullAddress(tags) {
    if (!tags) return "";
    return [
      osmStreet(tags),
      tags["addr:postcode"],
      tags["addr:city"] || tags["addr:place"] || tags["addr:suburb"]
    ]
      .filter(Boolean)
      .join(", ");
  }

  return {
    APIFY_API_TOKEN,
    OVERPASS_URL,
    NOMINATIM_URL,
    OVERPASS_ENDPOINTS,
    hasApify,
    hasOsm,
    friendlyError,
    sleep,
    extractCity,
    escapeOverpassRegex,
    osmTagClauses,
    geocodeLocation,
    buildOverpassQuery,
    isOfficialWebsite,
    osmWebsiteFromTags,
    osmPhoneFromTags,
    osmEmailFromTags,
    osmOpeningHours,
    osmCategories,
    osmStreet,
    osmFullAddress
  };
};
