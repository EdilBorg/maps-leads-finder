"use strict";
const assert = require("assert");

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  OK", name); })
    .catch((e) => { failed++; console.error("  FAIL", name, e.message); });
}

async function searchWithEndpoints(endpoints, fetchFn, perTryMs) {
  let lastErr = null;
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perTryMs);
    try {
      const res = await fetchFn(endpoint, { signal: controller.signal });
      if (res.status === 429 || res.status === 504 || res.status === 502) {
        lastErr = new Error("rate " + res.status);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error("http " + res.status);
        continue;
      }
      const data = await res.json();
      return Array.isArray(data.elements) ? data.elements : [];
    } catch (e) {
      lastErr = e.name === "AbortError" ? new Error("timeout " + endpoint) : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("unavailable");
}

async function run() {
  console.log("OSM search unit tests\n");

  await test("second endpoint used after first timeout", async () => {
    let calls = [];
    const elements = await searchWithEndpoints(
      ["http://a", "http://b"],
      async (url, opts) => {
        calls.push(url);
        if (url === "http://a") {
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
          json: async () => ({ elements: [{ type: "node", id: 1, tags: { name: "X" } }] })
        };
      },
      30
    );
    assert.deepStrictEqual(calls, ["http://a", "http://b"]);
    assert.strictEqual(elements.length, 1);
  });

  await test("HTTP error on first does not block second", async () => {
    const elements = await searchWithEndpoints(
      ["http://a", "http://b"],
      async (url) => {
        if (url === "http://a") return { status: 502, ok: false };
        return {
          status: 200,
          ok: true,
          json: async () => ({ elements: [] })
        };
      },
      5000
    );
    assert.strictEqual(elements.length, 0);
  });

  await test("valid empty elements is success not throw", async () => {
    const elements = await searchWithEndpoints(
      ["http://only"],
      async () => ({
        status: 200,
        ok: true,
        json: async () => ({ elements: [] })
      }),
      5000
    );
    assert.deepStrictEqual(elements, []);
  });

  await test("all endpoints fail throws", async () => {
    await assert.rejects(
      () =>
        searchWithEndpoints(
          ["http://a", "http://b"],
          async () => ({ status: 500, ok: false }),
          5000
        ),
      /http 500/
    );
  });

  console.log("\n%d passed, %d failed", passed, failed);
  process.exit(failed ? 1 : 0);
}
run();
