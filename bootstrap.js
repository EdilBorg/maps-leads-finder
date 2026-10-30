"use strict";
/**
 * Production entry: restore complete server.js if needed, run ensure scripts, then start.
 * Never require() ensure scripts in this process — they may call process.exit().
 */
const path = require("path");
const { spawnSync } = require("child_process");

function runEnsure(scriptRel) {
  const scriptPath = path.join(__dirname, scriptRel);
  console.log("[bootstrap] running", scriptRel);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: __dirname,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    console.error("[bootstrap] failed to start", scriptRel + ":", result.error.message);
    process.exit(1);
  }
  const code = result.status == null ? 1 : result.status;
  if (code !== 0) {
    console.error("[bootstrap] " + scriptRel + " exited with code " + code);
    process.exit(code || 1);
  }
  console.log("[bootstrap] " + scriptRel + " ok");
}

runEnsure("lib/install-server.js");
runEnsure("scripts/ensure-apify-fix.js");
runEnsure("scripts/ensure-index-fix.js");
runEnsure("scripts/ensure-message-route.js");
runEnsure("scripts/ensure-msg-styles.js");
runEnsure("scripts/ensure-server-hardening.js");
runEnsure("scripts/ensure-cache-bust.js");
runEnsure("scripts/ensure-template-json-safe.js");
runEnsure("scripts/ensure-index-search-json-safe.js");
runEnsure("scripts/ensure-gemini-commercial.js");

console.log("[bootstrap] starting server.js (PORT=" + (process.env.PORT || "3000") + ")");
require("./server.js");
