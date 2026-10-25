"use strict";

const assert = require("assert");
const locale = require("../lib/locale");
const leadFields = require("../lib/lead-fields");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  OK", name);
  } catch (e) {
    failed += 1;
    console.error("  FAIL", name, e.message);
  }
}

console.log("Locale + lead-fields tests\n");

test("normalizeCountryCode accepts ISO and aliases", () => {
  assert.strictEqual(locale.normalizeCountryCode("pt"), "PT");
  assert.strictEqual(locale.normalizeCountryCode("Portugal"), "PT");
  assert.strictEqual(locale.normalizeCountryCode("ES"), "ES");
  assert.strictEqual(locale.normalizeCountryCode("Brasil"), "BR");
  assert.strictEqual(locale.normalizeCountryCode("United Kingdom"), "GB");
  assert.strictEqual(locale.normalizeCountryCode(""), "");
  assert.strictEqual(locale.normalizeCountryCode("UnknownLand"), "");
});

test("resolveCommercialLocale Portugal -> pt-PT", () => {
  const r = locale.resolveCommercialLocale({ countryCode: "PT" });
  assert.strictEqual(r.language, "pt-PT");
  assert.strictEqual(r.countryCode, "PT");
  assert.strictEqual(r.source, "country_default");
});

test("resolveCommercialLocale Spain -> es-ES", () => {
  assert.strictEqual(locale.resolveCommercialLocale({ countryCode: "ES" }).language, "es-ES");
});

test("resolveCommercialLocale US/GB -> English variants", () => {
  assert.strictEqual(locale.resolveCommercialLocale({ countryCode: "US" }).language, "en-US");
  assert.strictEqual(locale.resolveCommercialLocale({ countryCode: "GB" }).language, "en-GB");
});

test("resolveCommercialLocale Brazil -> pt-BR", () => {
  assert.strictEqual(locale.resolveCommercialLocale({ countryCode: "BR" }).language, "pt-BR");
});

test("explicit language overrides country default", () => {
  const r = locale.resolveCommercialLocale({ countryCode: "PT", explicitLanguage: "en-GB" });
  assert.strictEqual(r.language, "en-GB");
  assert.strictEqual(r.source, "explicit");
});

test("multilingual countries flagged", () => {
  const be = locale.resolveCommercialLocale({ countryCode: "BE" });
  assert.strictEqual(be.multilingual, true);
});

test("isGoogleMapsPlaceUrl accepts place URLs only", () => {
  assert.strictEqual(
    leadFields.isGoogleMapsPlaceUrl("https://www.google.com/maps/place/Foo/@38.7,-9.1,17z"),
    true
  );
  assert.strictEqual(
    leadFields.isGoogleMapsPlaceUrl("https://www.google.com/maps/search/?api=1&query=Lisboa"),
    false
  );
  assert.strictEqual(leadFields.isGoogleMapsPlaceUrl("https://example.com/maps/place/x"), false);
  assert.strictEqual(leadFields.isGoogleMapsPlaceUrl(""), false);
});

test("extractGooglePlaceId ignores OSM ids", () => {
  assert.strictEqual(leadFields.extractGooglePlaceId({ placeId: "node/123" }), "");
  assert.strictEqual(
    leadFields.extractGooglePlaceId({ placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" }),
    "ChIJN1t_tDeuEmsRUsoyG83frY4"
  );
});

test("extractGoogleMapsUrl only keeps real place URLs", () => {
  assert.strictEqual(
    leadFields.extractGoogleMapsUrl({
      url: "https://www.google.com/maps/search/?api=1&query=test"
    }),
    ""
  );
  assert.strictEqual(
    leadFields.extractGoogleMapsUrl({
      url: "https://www.google.com/maps/place/Cafe/@1,2,17z"
    }),
    "https://www.google.com/maps/place/Cafe/@1,2,17z"
  );
});

test("buildGoogleMapsSearchUrl is fallback only", () => {
  const u = leadFields.buildGoogleMapsSearchUrl({ name: "A", city: "Lisboa" });
  assert.ok(u.includes("maps/search"));
  assert.ok(u.includes("Lisboa"));
});

test("primaryCategory uses first category", () => {
  assert.strictEqual(leadFields.primaryCategory(["shop:hairdresser", "amenity:x"]), "shop:hairdresser");
  assert.strictEqual(leadFields.primaryCategory([]), "");
});

console.log("\n%d passed, %d failed", passed, failed);
process.exit(failed ? 1 : 0);
