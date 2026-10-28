"use strict";
const assert = require("assert");
const { searchOpenStreetMap } = require("../lib/osm-search");

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log("  OK", name);
    })
    .catch((e) => {
      failed++;
      console.error("  FAIL", name, e && e.message ? e.message : e);
    });
}

function deps(overrides) {
  return Object.assign(
    {
      niche: "cabeleireiros",
      location: "Lisboa",
      limit: 10,
      endpoints: ["http://overpass-a.test", "http://overpass-b.test"],
      geocodeLocation: async () => ({
        south: 1,
        north: 2,
        west: 3,
        east: 4,
        display: "Lisboa"
      }),
      buildOverpassQuery: () => "[out:json];out;",
      normalizeOsmElement: (el) => {
        if (!el || !el.tags || !el.tags.name) return null;
        return {
          name: el.tags.name,
          address: "",
          phone: "",
          source: "openstreetmap",
          sources: ["openstreetmap"]
        };
      },
      timeoutMs: 80
    },
    overrides || {}
  );
}

async function run() {
  console.log("OSM search unit tests (lib/osm-search.js production module)\n");

  await test("rejects missing niche", async () => {
    await assert.rejects(
      () => searchOpenStreetMap(deps({ niche: "" })),
      /Nicho/
    );
  });

  await test("second endpoint used after first AbortError timeout", async () => {
    const calls = [];
    const places = await searchOpenStreetMap(
      deps({
        timeoutMs: 40,
        fetchFn: async (url, opts) => {
          calls.push(url);
          if (url.includes("overpass-a")) {
            await new Promise((_, rej) => {
              opts.signal.addEventListener("abort", () => {
                const e = new Error("aborted");
                e.name = "AbortError";
                rej(e);
              });
            });
          }
          return {
            status: 200,
            ok: true,
            json: async () => ({
              elements: [{ type: "node", id: 1, tags: { name: "Salão A" } }]
            })
          };
        }
      })
    );
    assert.deepStrictEqual(calls, [
      "http://overpass-a.test",
      "http://overpass-b.test"
    ]);
    assert.strictEqual(places.length, 1);
    assert.strictEqual(places[0].name, "Salão A");
  });

  await test("HTTP 502 on first does not block second endpoint", async () => {
    const places = await searchOpenStreetMap(
      deps({
        fetchFn: async (url) => {
          if (url.includes("overpass-a")) {
            return { status: 502, ok: false, text: async () => "bad gateway" };
          }
          return {
            status: 200,
            ok: true,
            json: async () => ({ elements: [] })
          };
        }
      })
    );
    assert.deepStrictEqual(places, []);
  });

  await test("valid empty elements is success (zero results, not throw)", async () => {
    const places = await searchOpenStreetMap(
      deps({
        endpoints: ["http://only.test"],
        fetchFn: async () => ({
          status: 200,
          ok: true,
          json: async () => ({ elements: [] })
        })
      })
    );
    assert.deepStrictEqual(places, []);
  });

  await test("all endpoints fail throws last error", async () => {
    await assert.rejects(
      () =>
        searchOpenStreetMap(
          deps({
            fetchFn: async () => ({
              status: 500,
              ok: false,
              text: async () => "err"
            })
          })
        ),
      /Overpass erro 500/
    );
  });

  await test("geocode failure propagates", async () => {
    await assert.rejects(
      () =>
        searchOpenStreetMap(
          deps({
            geocodeLocation: async () => {
              throw new Error("Sem resultados de localização para: X");
            }
          })
        ),
      /localização/
    );
  });

  await test("each attempt uses a fresh AbortController (parallel safe)", async () => {
    const signals = [];
    await searchOpenStreetMap(
      deps({
        endpoints: ["http://a.test", "http://b.test"],
        fetchFn: async (url, opts) => {
          signals.push(opts.signal);
          if (url.includes("a.test")) {
            return { status: 429, ok: false, text: async () => "rate" };
          }
          return {
            status: 200,
            ok: true,
            json: async () => ({
              elements: [{ type: "node", id: 2, tags: { name: "B" } }]
            })
          };
        }
      })
    );
    assert.strictEqual(signals.length, 2);
    assert.notStrictEqual(signals[0], signals[1]);
  });

  console.log("\n%d passed, %d failed", passed, failed);
  process.exit(failed ? 1 : 0);
}

run();
