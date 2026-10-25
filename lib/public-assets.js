"use strict";

const path = require("path");

/** Exact public paths served from project root (allowlist). */
const PUBLIC_FILES = Object.freeze({
  "/styles.css": { file: "styles.css", type: "css" },
  "/history.js": { file: "history.js", type: "js" },
  "/template.js": { file: "template.js", type: "js" },
  "/login.css": { file: "login.css", type: "css" },
  "/login.js": { file: "login.js", type: "js" }
});

/**
 * Paths that must never be served (defence in depth).
 */
function isSensitivePath(urlPath) {
  const raw = String(urlPath || "").split("?")[0].toLowerCase();
  const normalized = path.posix.normalize("/" + raw.replace(/^\/+/, ""));

  if (
    normalized === "/.env" ||
    normalized.startsWith("/.env.") ||
    normalized.includes("/.env")
  ) {
    return true;
  }

  const blockedPrefixes = [
    "/data",
    "/lib",
    "/node_modules",
    "/.git",
    "/tests",
    "/sessions"
  ];
  for (const p of blockedPrefixes) {
    if (normalized === p || normalized.startsWith(p + "/")) return true;
  }

  const blockedExact = new Set([
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/.gitignore",
    "/.env.example",
    "/deploy.md",
    "/readme.md",
    "/roadmap-v5.md",
    "/design.md",
    "/otp-store.json"
  ]);
  if (blockedExact.has(normalized)) return true;

  if (normalized.includes("..")) return true;
  if (normalized.split("/").some((seg) => seg.startsWith(".") && seg !== ".")) {
    if (normalized !== "/") return true;
  }

  return false;
}

function mountPublicAssets(app, rootDir) {
  for (const [route, meta] of Object.entries(PUBLIC_FILES)) {
    app.get(route, (req, res) => {
      res.type(meta.type);
      res.sendFile(path.join(rootDir, meta.file));
    });
  }
}

function blockSensitiveFiles(req, res, next) {
  if (isSensitivePath(req.path)) {
    return res.status(404).json({ success: false, error: "Não encontrado." });
  }
  return next();
}

module.exports = {
  PUBLIC_FILES,
  isSensitivePath,
  mountPublicAssets,
  blockSensitiveFiles
};
