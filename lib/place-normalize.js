"use strict";
module.exports = function createPlaceNormalize(deps) {
  const { locale, leadFields } = deps;
  const {
    extractCity,
    isOfficialWebsite,
    osmWebsiteFromTags,
    osmPhoneFromTags,
    osmEmailFromTags,
    osmOpeningHours,
    osmCategories,
    osmStreet,
    osmFullAddress
  } = deps.constants;

  function emptyPlace() {
    return {
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
  }

  function normalizeOsmElement(el) {
    const tags = el.tags || {};
    const lat =
      el.lat != null
        ? Number(el.lat)
        : el.center && el.center.lat != null
          ? Number(el.center.lat)
          : null;
    const lon =
      el.lon != null
        ? Number(el.lon)
        : el.center && el.center.lon != null
          ? Number(el.center.lon)
          : null;
    const name = tags.name || tags["name:pt"] || tags.brand || "";
    if (!name) return null;
    const street = osmStreet(tags);
    const city = tags["addr:city"] || tags["addr:place"] || "";
    const address = osmFullAddress(tags);
    const place = emptyPlace();
    place.name = name;
    place.street = street;
    place.city = city || extractCity(address);
    place.state = tags["addr:state"] || tags["addr:province"] || "";
    place.countryCode = tags["addr:country"] || "";
    place.address = address;
    place.website = osmWebsiteFromTags(tags);
    place.phone = osmPhoneFromTags(tags);
    place.email = osmEmailFromTags(tags);
    place.categories = osmCategories(tags);
    place.openingHours = osmOpeningHours(tags);
    place.latitude = Number.isFinite(lat) ? lat : null;
    place.longitude = Number.isFinite(lon) ? lon : null;
    const osmId = el.type && el.id ? `${el.type}/${el.id}` : "";
    place.osmId = osmId;
    place.place_id = osmId;
    place.googlePlaceId = "";
    place.googleMapsUrl = "";
    place.category = leadFields.primaryCategory(place.categories);
    place.countryCode = locale.normalizeCountryCode(place.countryCode) || place.countryCode;
    place.source = "openstreetmap";
    place.sources = ["openstreetmap"];
    return place;
  }

  function normalizeApifyPlace(p) {
    if (!p) return null;
    const name = p.title || p.name || "";
    if (!name) return null;
    const websiteRaw = p.website || "";
    const website = isOfficialWebsite(websiteRaw) ? String(websiteRaw).trim() : "";
    let rating = null;
    if (p.totalScore != null && p.totalScore !== "") {
      const n = Number(p.totalScore);
      if (Number.isFinite(n)) rating = n;
    } else if (p.rating != null && p.rating !== "") {
      const n = Number(p.rating);
      if (Number.isFinite(n)) rating = n;
    }
    let reviews = null;
    if (p.reviewsCount != null && p.reviewsCount !== "") {
      const n = Number(p.reviewsCount);
      if (Number.isFinite(n)) reviews = n;
    } else if (p.reviews != null && p.reviews !== "") {
      const n = Number(p.reviews);
      if (Number.isFinite(n)) reviews = n;
    }
    const street = p.street || "";
    const city = p.city || "";
    const state = p.state || "";
    const countryCode = p.countryCode || p.country || "";
    const addressParts = [street, city, state].filter(Boolean);
    const address = addressParts.length ? addressParts.join(", ") : p.address || "";
    let categories = [];
    if (Array.isArray(p.categories)) categories = p.categories.map(String);
    else if (typeof p.categoryName === "string" && p.categoryName) categories = [p.categoryName];
    const place = emptyPlace();
    place.name = name;
    place.rating = rating;
    place.reviews = reviews;
    place.street = street;
    place.city = city || extractCity(address);
    place.state = state;
    place.countryCode = countryCode;
    place.address = address;
    place.website = website;
    place.phone = (p.phone || "").trim();
    place.email = (p.email || "").trim();
    place.categories = categories;
    place.openingHours = p.openingHours || p.opening_hours || "";
    place.latitude =
      p.location && p.location.lat != null
        ? Number(p.location.lat)
        : p.lat != null
          ? Number(p.lat)
          : null;
    place.longitude =
      p.location && p.location.lng != null
        ? Number(p.location.lng)
        : p.lng != null
          ? Number(p.lng)
          : p.lon != null
            ? Number(p.lon)
            : null;
    const googlePlaceId = leadFields.extractGooglePlaceId(p);
    const googleMapsUrl = leadFields.extractGoogleMapsUrl(p);
    place.googlePlaceId = googlePlaceId;
    place.googleMapsUrl = googleMapsUrl;
    place.osmId = "";
    place.place_id = googlePlaceId || "";
    place.category = leadFields.primaryCategory(place.categories);
    place.countryCode =
      locale.normalizeCountryCode(place.countryCode) || String(place.countryCode || "").trim();
    place.source = "apify";
    place.sources = ["apify"];
    return place;
  }

  return { emptyPlace, normalizeOsmElement, normalizeApifyPlace };
};
