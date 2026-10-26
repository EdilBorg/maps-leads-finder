/**
 * Maps Leads Finder - Backend
 * Motores: OpenStreetMap (Overpass) + Apify
 * Auth: OTP email + sessões seguras
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
const session = require("express-session");
const FileStore = require("session-file-store")(session);

const { mountAuthRoutes, requireAuth, requireAuthPage } = require("./lib/auth-routes");
const locale = require("./lib/locale");
const leadFields = require("./lib/lead-fields");

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
  console.warn("[auth] Variáveis em falta ou placeholder:", authMissing.join(", "));
  console.warn("[auth] O login OTP não funcionará até configurar o .env");
}

app.set("trust proxy", 1);
app.use(cors({ origin: false }));
app.use(express.json({ limit: "32kb" }));

app.use(
  session({
    name: "mlf.sid",
    secret: process.env.SESSION_SECRET || "dev-only-change-me-not-for-production",
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
      path: path.join(__dirname, "data", "sessions"),
      ttl: 60 * 60 * 24 * 7,
      retries: 1,
      logFn: function () {}
    }),
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "strict" : "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

// Auth pages and assets MUST be registered before express.static.
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

app.use(
  express.static(path.join(__dirname), {
    index: false
  })
);

require("./lib/app-core")(app, {
  requireAuth,
  requireAuthPage,
  path,
  fetch,
  isProd,
  authMissing,
  PORT,
  locale,
  leadFields
});
