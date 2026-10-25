"use strict";

/**
 * Helpers to extract Google Maps identifiers/URLs from raw provider payloads
 * without inventing data. OSM does not provide Google place IDs or place URLs.
 */

function isGoogleMapsPlaceUrl(value) {
  if (value == null || value === "") return false;
  const s = String(value).trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (
      host !== "google.com" &&
      host !== "maps.google.com" &&
      host !== "maps.app.goo.gl" &&
      !host.endsWith(".google.com")
    ) {
      if (host === "goo.gl" && /\/maps/i.test(u.pathname)) return true;
      if (host === "maps.app.goo.gl") return true;
      return false;
    }
    if (/\/maps\/place\//i.test(u.pathname)) return true;
    if (/\/maps\/place\//i.test(s)) return true;
    if (u.searchParams.has("cid")) return true;
    if (u.searchParams.has("place_id") || u.searchParams.has("query_place_id")) return true;
    if (/!3m1!1s0x/i.test(s)) return true;
    if (/place_id[=:]/i.test(s)) return true;
    return false;
  } catch {
    return false;
  }
}

function extractGooglePlaceId(raw) {
  if (!raw || typeof raw !== "object") return "";
  const candidates = [raw.placeId, raw.place_id, raw.googlePlaceId, raw.google_place_id];
  for (const c of candidates) {
    if (c == null || c === "") continue;
    const s = String(c).trim();
    if (/^(node|way|relation)\//i.test(s)) continue;
    if (s.length >= 8) return s;
  }
  return "";
}

function extractGoogleMapsUrl(raw) {
  if (!raw || typeof raw !== "object") return "";
  const candidates = [
    raw.url,
    raw.placeUrl,
    raw.place_url,
    raw.googleMapsUrl,
    raw.google_maps_url,
    raw.mapsUrl,
    raw.locationLink
  ];
  for (const c of candidates) {
    if (isGoogleMapsPlaceUrl(c)) return String(c).trim();
  }
  return "";
}

function buildGoogleMapsSearchUrl(lead) {
  const parts = [lead && lead.name, lead && lead.address, lead && lead.city].filter(Boolean);
  if (!parts.length) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(parts.join(", "));
}

function primaryCategory(categories) {
  if (!Array.isArray(categories) || !categories.length) return "";
  return String(categories[0] || "").trim();
}

module.exports = {
  isGoogleMapsPlaceUrl,
  extractGooglePlaceId,
  extractGoogleMapsUrl,
  buildGoogleMapsSearchUrl,
  primaryCategory
};
