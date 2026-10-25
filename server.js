/**
 * Maps Leads Finder - Backend
 * Motores: OpenStreetMap (Overpass) + Apify
 * Auth: OTP email + sessoes seguras
 * Security hardened 2026-10
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const helmet = require("helmet");

const { mountAuthRoutes, requireAuth, requireAuthPage } = require("./lib/auth-routes");

/** Session duration: 24 hours */
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24;

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

function validateAuthEnv() {
  const missing = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes("colocar_")) {
    missing.push("SESSION_SECRET");
  }
  if (!process.env.AUTH_EMAIL) missing.push("AUTH_EMAIL");
  if (!process.env.SMTP_USER) missing.push("SMTP_USER");
  if (!process.env.SMTP_PASS || String(process.env.SMTP_PASS).includes("colocar_")) {
    missing.push("SMTP_PASS");
  }
  return missing;
}

const authMissing = validateAuthEnv();
if (authMissing.length) {
  console.warn("[auth] Variaveis em falta ou placeholder:", authMissing.join(", "));
  if (isProd) {
    console.error("[auth] Em producao SESSION_SECRET, AUTH_EMAIL e SMTP_* sao obrigatorios. A aplicacao nao arranca.");
    process.exit(1);
  }
  console.warn("[auth] O login OTP nao funcionara ate configurar o .env");
}

app.set("trust proxy", 1);
app.use(cors({ origin: false }));
app.use(express.json({ limit: "32kb" }));

const sessionSecret = process.env.SESSION_SECRET;
if (isProd && (!sessionSecret || sessionSecret.includes("colocar_"))) {
  console.error("[auth] SESSION_SECRET invalido em producao.");
  process.exit(1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
  })
);

app.use(
  session({
    name: "mlf.sid",
    secret: sessionSecret || "dev-only-change-me-not-for-production",
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
      path: path.join(__dirname, "data", "sessions"),
      ttl: Math.floor(SESSION_MAX_AGE_MS / 1000),
      retries: 1,
      logFn: function () {}
    }),
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "strict" : "lax",
      maxAge: SESSION_MAX_AGE_MS
    }
  })
);

mountAuthRoutes(app);

app.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect("/");
  }
  res.type("html");
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/login.css", (req, res) => {
  res.type("css");
  res.sendFile(path.join(__dirname, "login.css"));
});

app.get("/login.js", (req, res) => {
  res.type("js");
  res.sendFile(path.join(__dirname, "login.js"));
});

// Public assets only — NEVER serve project root (would expose .env, data/, server.js, lib/).
const PUBLIC_ASSETS = {
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/history.js": { file: "history.js", type: "application/javascript; charset=utf-8" },
  "/template.js": { file: "template.js", type: "application/javascript; charset=utf-8" }
};

app.get(Object.keys(PUBLIC_ASSETS), (req, res, next) => {
  const meta = PUBLIC_ASSETS[req.path];
  if (!meta) return next();
  res.type(meta.type);
  res.set("Cache-Control", isProd ? "public, max-age=300" : "no-store");
  res.sendFile(path.join(__dirname, meta.file), (err) => {
    if (err) next(err);
  });
});

require("./lib/search-app-loader")(app, {
  requireAuth,
  requireAuthPage,
  isProd,
  path,
  fetch
});

app.listen(PORT, () => {
  console.log(`\nMaps Leads Finder em http://localhost:${PORT}`);
  console.log(`   Auth OTP:       ${authMissing.length ? "config em falta" : "pronto"}\n`);
});
