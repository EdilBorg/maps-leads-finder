"use strict";

/**
 * Commercial locale mapping for future personalized outreach messages.
 * Search location (where businesses are found) is independent of the
 * commercial country/language used to write messages.
 *
 * ISO 3166-1 alpha-2 country codes. Language tags are BCP 47 style.
 */

const COUNTRY_DEFAULTS = {
  PT: { language: "pt-PT", label: "Portugal", languageLabel: "Português (Portugal)" },
  ES: { language: "es-ES", label: "Espanha", languageLabel: "Espanhol (Espanha)" },
  BR: { language: "pt-BR", label: "Brasil", languageLabel: "Português (Brasil)" },
  US: { language: "en-US", label: "Estados Unidos", languageLabel: "English (US)" },
  GB: { language: "en-GB", label: "Reino Unido", languageLabel: "English (UK)" },
  IE: { language: "en-IE", label: "Irlanda", languageLabel: "English (Ireland)" },
  FR: { language: "fr-FR", label: "França", languageLabel: "Français" },
  DE: { language: "de-DE", label: "Alemanha", languageLabel: "Deutsch" },
  IT: { language: "it-IT", label: "Itália", languageLabel: "Italiano" },
  NL: { language: "nl-NL", label: "Países Baixos", languageLabel: "Nederlands" },
  BE: { language: "nl-BE", label: "Bélgica", languageLabel: "Nederlands / Français (escolher)" },
  CH: { language: "de-CH", label: "Suíça", languageLabel: "Deutsch / Français / Italiano (escolher)" },
  AT: { language: "de-AT", label: "Áustria", languageLabel: "Deutsch (Österreich)" },
  MZ: { language: "pt-MZ", label: "Moçambique", languageLabel: "Português (Moçambique)" },
  AO: { language: "pt-AO", label: "Angola", languageLabel: "Português (Angola)" },
  CV: { language: "pt-CV", label: "Cabo Verde", languageLabel: "Português (Cabo Verde)" }
};

const MULTILINGUAL_COUNTRIES = new Set(["BE", "CH", "CA", "LU"]);

const LANGUAGE_OPTIONS = [
  { code: "pt-PT", label: "Português (Portugal)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "pt-MZ", label: "Português (Moçambique)" },
  { code: "es-ES", label: "Espanhol (Espanha)" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" },
  { code: "it-IT", label: "Italiano" },
  { code: "nl-NL", label: "Nederlands" }
];

function normalizeCountryCode(input) {
  if (input == null || input === "") return "";
  const raw = String(input).trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();

  const aliases = {
    portugal: "PT",
    espanha: "ES",
    spain: "ES",
    españa: "ES",
    brasil: "BR",
    brazil: "BR",
    "estados unidos": "US",
    "united states": "US",
    usa: "US",
    "reino unido": "GB",
    "united kingdom": "GB",
    uk: "GB",
    frança: "FR",
    france: "FR",
    alemanha: "DE",
    germany: "DE",
    itália: "IT",
    italy: "IT",
    moçambique: "MZ",
    mozambique: "MZ",
    angola: "AO"
  };
  const key = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return aliases[key] || "";
}

function resolveCommercialLocale(opts) {
  const options = opts || {};
  const countryCode = normalizeCountryCode(options.countryCode || options.country || "");
  const explicit =
    options.explicitLanguage || options.language
      ? String(options.explicitLanguage || options.language).trim()
      : "";

  if (explicit) {
    return {
      countryCode: countryCode || "",
      language: explicit,
      multilingual: countryCode ? MULTILINGUAL_COUNTRIES.has(countryCode) : false,
      source: "explicit"
    };
  }

  if (countryCode && COUNTRY_DEFAULTS[countryCode]) {
    return {
      countryCode,
      language: COUNTRY_DEFAULTS[countryCode].language,
      multilingual: MULTILINGUAL_COUNTRIES.has(countryCode),
      source: "country_default"
    };
  }

  if (countryCode) {
    return {
      countryCode,
      language: "",
      multilingual: MULTILINGUAL_COUNTRIES.has(countryCode),
      source: "country_unknown_language"
    };
  }

  return {
    countryCode: "",
    language: "",
    multilingual: false,
    source: "unset"
  };
}

function listCountriesForUi() {
  return Object.keys(COUNTRY_DEFAULTS)
    .sort()
    .map((code) => ({
      code,
      label: COUNTRY_DEFAULTS[code].label,
      defaultLanguage: COUNTRY_DEFAULTS[code].language,
      multilingual: MULTILINGUAL_COUNTRIES.has(code)
    }));
}

function listLanguagesForUi() {
  return LANGUAGE_OPTIONS.slice();
}

module.exports = {
  COUNTRY_DEFAULTS,
  MULTILINGUAL_COUNTRIES,
  LANGUAGE_OPTIONS,
  normalizeCountryCode,
  resolveCommercialLocale,
  listCountriesForUi,
  listLanguagesForUi
};
