"use strict";
module.exports = function createPlaceFilters(deps) {
  const isOfficialWebsite =
    deps && deps.isOfficialWebsite ? deps.isOfficialWebsite : function () { return false; };

  function filterNoWebsite(places) {
    return places.filter((p) => !isOfficialWebsite(p.website));
  }

  function filterQuality(places, minRating, minReviews) {
    const minR = Number(minRating) || 0;
    const minRev = Number(minReviews) || 0;
    if (minR <= 0 && minRev <= 0) return places;
    return places.filter((p) => {
      const isOsmOnly =
        (p.source === "openstreetmap" || p.source === "osm") &&
        !(p.sources && p.sources.includes("apify"));
      if (isOsmOnly) return true;
      if (minR > 0) {
        if (p.rating == null || !Number.isFinite(Number(p.rating))) {
          if (p.source === "apify" && !(p.sources && p.sources.includes("openstreetmap"))) return false;
          return true;
        }
        if (Number(p.rating) < minR) return false;
      }
      if (minRev > 0) {
        if (p.reviews == null || !Number.isFinite(Number(p.reviews))) {
          if (p.source === "apify" && !(p.sources && p.sources.includes("openstreetmap"))) return false;
          return true;
        }
        if (Number(p.reviews) < minRev) return false;
      }
      return true;
    });
  }

  function sortByQuality(places) {
    return [...places].sort((a, b) => {
      const reviewsA = a.reviews == null ? -1 : Number(a.reviews) || 0;
      const reviewsB = b.reviews == null ? -1 : Number(b.reviews) || 0;
      const ratingA = a.rating == null ? -1 : Number(a.rating) || 0;
      const ratingB = b.rating == null ? -1 : Number(b.rating) || 0;
      const scoreA = (reviewsA >= 0 ? reviewsA * 10 : 0) + (ratingA >= 0 ? ratingA * 100 : 0);
      const scoreB = (reviewsB >= 0 ? reviewsB * 10 : 0) + (ratingB >= 0 ? ratingB * 100 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (a.name || "").localeCompare(b.name || "", "pt");
    });
  }

  function normalizeName(name) {
    return String(name || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function normalizePhone(phone) {
    return String(phone || "").replace(/\D/g, "");
  }
  function pickNonEmpty(...vals) {
    for (const a of vals) {
      if (a != null && a !== "" && !(Array.isArray(a) && !a.length)) return a;
    }
    return vals.length ? vals[vals.length - 1] : "";
  }
  function mergePlaces(a, b) {
    const merged = {
      name: "",
      rating: null,
      reviews: null,
      street: "",
      city: "",
      state: "",
      countryCode: "",
      address: "",
      website: "",
      phone: "",
      email: "",
      categories: [],
      category: "",
      openingHours: "",
      latitude: null,
      longitude: null,
      place_id: "",
      googlePlaceId: "",
      osmId: "",
      googleMapsUrl: "",
      source: "",
      sources: []
    };
    merged.name = pickNonEmpty(a.name, b.name);
    merged.rating = a.rating != null ? a.rating : b.rating;
    merged.reviews = a.reviews != null ? a.reviews : b.reviews;
    merged.street = pickNonEmpty(a.street, b.street);
    merged.city = pickNonEmpty(a.city, b.city);
    merged.state = pickNonEmpty(a.state, b.state);
    merged.countryCode = pickNonEmpty(a.countryCode, b.countryCode);
    merged.address = pickNonEmpty(a.address, b.address);
    merged.website = pickNonEmpty(a.website, b.website);
    merged.phone = pickNonEmpty(a.phone, b.phone);
    merged.email = pickNonEmpty(a.email, b.email);
    merged.categories = [...new Set([...(a.categories || []), ...(b.categories || [])])];
    merged.openingHours = pickNonEmpty(a.openingHours, b.openingHours);
    merged.latitude = a.latitude != null ? a.latitude : b.latitude;
    merged.longitude = a.longitude != null ? a.longitude : b.longitude;
    merged.googlePlaceId = pickNonEmpty(a.googlePlaceId, b.googlePlaceId);
    merged.osmId = pickNonEmpty(a.osmId, b.osmId);
    merged.googleMapsUrl = pickNonEmpty(a.googleMapsUrl, b.googleMapsUrl);
    merged.place_id = pickNonEmpty(merged.googlePlaceId, a.place_id, b.place_id, merged.osmId);
    merged.category = pickNonEmpty(
      a.category,
      b.category,
      (merged.categories && merged.categories[0]) || ""
    );
    const sources = [
      ...new Set(
        [...(a.sources || [a.source]), ...(b.sources || [b.source])].filter(Boolean)
      )
    ];
    merged.sources = sources;
    merged.source = sources.length > 1 ? "combined" : sources[0] || a.source || b.source;
    return merged;
  }
  function isSameBusiness(a, b) {
    const phoneA = normalizePhone(a.phone);
    const phoneB = normalizePhone(b.phone);
    if (phoneA && phoneB && phoneA.length >= 8 && phoneA === phoneB) return true;
    const nameA = normalizeName(a.name);
    const nameB = normalizeName(b.name);
    if (!nameA || !nameB || nameA !== nameB) return false;
    if (phoneA && phoneB && phoneA.slice(-8) === phoneB.slice(-8)) return true;
    const cityA = normalizeName(a.city);
    const cityB = normalizeName(b.city);
    if (cityA && cityB && cityA === cityB) return true;
    if (a.latitude != null && b.latitude != null && a.longitude != null && b.longitude != null) {
      if (Math.abs(a.latitude - b.latitude) < 0.001 && Math.abs(a.longitude - b.longitude) < 0.001)
        return true;
    }
    return false;
  }
  function dedupeAndMerge(places) {
    const out = [];
    for (const p of places) {
      let merged = false;
      for (let i = 0; i < out.length; i++) {
        if (isSameBusiness(out[i], p)) {
          out[i] = mergePlaces(out[i], p);
          merged = true;
          break;
        }
      }
      if (!merged) out.push(p);
    }
    return out;
  }
  function applyFilters(places, onlyNoWebsite, minRating, minReviews) {
    let list = places;
    if (onlyNoWebsite) list = filterNoWebsite(list);
    return filterQuality(list, minRating, minReviews);
  }

  return {
    normalizeName,
    normalizePhone,
    pickNonEmpty,
    mergePlaces,
    isSameBusiness,
    dedupeAndMerge,
    applyFilters,
    sortByQuality,
    filterNoWebsite,
    filterQuality
  };
};
