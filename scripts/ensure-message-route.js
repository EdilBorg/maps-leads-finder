"use strict";
/**
 * Idempotent: wire POST /api/messages/generate into server.js if missing.
 */
const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "..", "server.js");
let src = fs.readFileSync(serverPath, "utf8");
let changed = false;

if (!src.includes('require("./lib/message-routes")') && !src.includes("require('./lib/message-routes')")) {
  const needle = 'const { mountAuthRoutes, requireAuth, requireAuthPage } = require("./lib/auth-routes");';
  if (!src.includes(needle)) {
    console.error("[ensure-message-route] auth-routes require not found");
    process.exit(1);
  }
  src = src.replace(
    needle,
    needle + '\nconst { mountMessageRoutes } = require("./lib/message-routes");'
  );
  changed = true;
}

if (!src.includes("/api/messages/generate") && !src.includes("mountMessageRoutes(app")) {
  const marker = 'app.post("/api/search", requireAuth,';
  if (!src.includes(marker)) {
    console.error("[ensure-message-route] /api/search route not found");
    process.exit(1);
  }
  src = src.replace(
    marker,
    "mountMessageRoutes(app, { requireAuth });\n\n" + marker
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(serverPath, src);
  console.log("[ensure-message-route] server.js updated");
} else {
  console.log("[ensure-message-route] already applied");
}
