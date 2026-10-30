"use strict";
const assert = require("assert");
const {
  searchApify,
  fetchWithTimeout,
  classifyHttpError,
  START_TIMEOUT_MS,
  POLL_TIMEOUT_MS,
  DATASET_TIMEOUT_MS
} = require("../lib/apify-search");

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(function () {
      passed++;
      console.log("  OK", name);
    })
    .catch(function (e) {
      failed++;
      console.error("  FAIL", name, e && e.message ? e.message : e);
    });
}

console.log("Apify timeout / HTTP unit tests\n");

async function run() {
  await test("timeout constants are positive numbers", function () {
    assert.ok(START_TIMEOUT_MS > 0 && POLL_TIMEOUT_MS > 0 && DATASET_TIMEOUT_MS > 0);
  });

  await test("fetchWithTimeout aborts and codes APIFY_TIMEOUT", async function () {
    const slowFetch = function () {
      return new Promise(function () {});
    };
    let err = null;
    try {
      await fetchWithTimeout(slowFetch, "http://example.test", {}, 50, "start");
    } catch (e) {
      err = e;
    }
    assert.ok(err, "expected timeout error");
    assert.strictEqual(err.code, "APIFY_TIMEOUT");
    assert.ok(/timeout/i.test(err.message));
  });

  await test("fetchWithTimeout maps network errors to APIFY_NETWORK", async function () {
    const badFetch = function () {
      const e = new Error("ECONNRESET");
      e.code = "ECONNRESET";
      return Promise.reject(e);
    };
    let err = null;
    try {
      await fetchWithTimeout(badFetch, "http://example.test", {}, 5000, "polling");
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "APIFY_NETWORK");
  });

  await test("classifyHttpError 429 / 401 / 500", function () {
    assert.strictEqual(classifyHttpError(429, "slow", "polling").code, "APIFY_RATE_LIMIT");
    assert.strictEqual(classifyHttpError(401, "", "start").code, "APIFY_AUTH");
    assert.strictEqual(classifyHttpError(503, "down", "dataset").code, "APIFY_SERVER");
  });

  await test("searchApify start timeout uses AbortController", async function () {
    const slowFetch = function () {
      return new Promise(function () {});
    };
    let err = null;
    try {
      await searchApify({
        query: "advogado",
        location: "Lisboa",
        limit: 5,
        token: "test-token-xyz",
        fetchFn: slowFetch,
        startTimeoutMs: 40
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "APIFY_TIMEOUT");
    assert.ok(/start/i.test(err.message));
  });

  await test("searchApify polling timeout", async function () {
    let calls = 0;
    const fetchFn = function (url) {
      calls++;
      if (String(url).includes("/runs?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({ data: { id: "run1", defaultDatasetId: "ds1" } });
          },
          text: function () {
            return Promise.resolve("");
          }
        });
      }
      return new Promise(function () {});
    };
    let err = null;
    try {
      await searchApify({
        query: "cafe",
        location: "Porto",
        limit: 5,
        token: "test-token-xyz",
        fetchFn: fetchFn,
        startTimeoutMs: 5000,
        pollTimeoutMs: 40
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "APIFY_TIMEOUT");
    assert.ok(/polling/i.test(err.message));
    assert.ok(calls >= 2);
  });

  await test("searchApify dataset timeout after SUCCEEDED", async function () {
    let calls = 0;
    const fetchFn = function (url) {
      calls++;
      if (String(url).includes("/runs?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({ data: { id: "run2", defaultDatasetId: "ds2" } });
          },
          text: function () {
            return Promise.resolve("");
          }
        });
      }
      if (String(url).includes("/actor-runs/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({ data: { status: "SUCCEEDED" } });
          },
          text: function () {
            return Promise.resolve("");
          }
        });
      }
      return new Promise(function () {});
    };
    let err = null;
    try {
      await searchApify({
        query: "loja",
        location: "Lisboa",
        limit: 5,
        token: "test-token-xyz",
        fetchFn: fetchFn,
        startTimeoutMs: 5000,
        pollTimeoutMs: 5000,
        datasetTimeoutMs: 40
      });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "APIFY_TIMEOUT");
    assert.ok(/dataset/i.test(err.message));
  });

  console.log("\n%d passed, %d failed", passed, failed);
  process.exit(failed ? 1 : 0);
}

run();
