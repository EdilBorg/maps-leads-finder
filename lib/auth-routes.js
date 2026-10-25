"use strict";

const otp = require("./otp");
const mail = require("./mail");

const PURPOSE = "login";

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

function checkOrigin(req) {
  if (process.env.NODE_ENV !== "production") return true;
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const host = req.headers.host || "";
  // In production, require Origin or Referer for state-changing requests.
  // SameSite=strict cookies already mitigate classic CSRF; this adds defense in depth.
  if (!origin && !referer) {
    const method = (req.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
    return false;
  }
  if (origin) {
    try {
      const o = new URL(origin);
      return o.host === host;
    } catch {
      return false;
    }
  }
  if (referer) {
    try {
      const r = new URL(referer);
      return r.host === host;
    } catch {
      return false;
    }
  }
  return false;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated === true) {
    return next();
  }
  return res.status(401).json({
    success: false,
    code: "UNAUTHORIZED",
    error: "Autenticação necessária."
  });
}

function requireAuthPage(req, res, next) {
  if (req.session && req.session.authenticated === true) {
    return next();
  }
  return res.redirect("/login");
}

function mountAuthRoutes(app) {
  const authEmail = process.env.AUTH_EMAIL || "";

  app.get("/api/auth/session", (req, res) => {
    const authenticated = !!(req.session && req.session.authenticated);
    res.json({
      authenticated,
      maskedEmail: authEmail ? otp.maskEmail(authEmail) : null
    });
  });

  app.post("/api/auth/request-otp", async (req, res) => {
    try {
      if (!checkOrigin(req)) {
        return res.status(403).json({ success: false, error: "Pedido rejeitado." });
      }
      if (!authEmail) {
        return res.status(503).json({
          success: false,
          error: "Autenticação não configurada no servidor."
        });
      }
      if (!mail.isMailConfigured()) {
        return res.status(503).json({
          success: false,
          error: "Serviço de email não configurado."
        });
      }

      const result = otp.createOtp(PURPOSE, clientIp(req));
      if (!result.ok) {
        if (result.error === "cooldown") {
          return res.status(429).json({
            success: false,
            error: "Aguarde antes de solicitar um novo código.",
            retryAfterSec: result.retryAfterSec
          });
        }
        if (result.error === "rate_limit") {
          return res.status(429).json({
            success: false,
            error: "Demasiados pedidos. Tente mais tarde.",
            retryAfterSec: result.retryAfterSec
          });
        }
        return res.status(400).json({ success: false, error: "Não foi possível gerar o código." });
      }

      try {
        await mail.sendOtpEmail(authEmail, result.code);
      } catch (e) {
        const detail = e.smtp || (typeof mail.describeSmtpError === "function" ? mail.describeSmtpError(e) : null);
        if (detail) {
          console.error("[auth] SMTP send failed:", JSON.stringify(detail));
        } else {
          console.error("[auth] SMTP send failed:", e.code || e.message);
        }
        return res.status(502).json({
          success: false,
          error: "Não foi possível enviar o email. Tente novamente."
        });
      }

      return res.json({
        success: true,
        message: "Código enviado para o email autorizado.",
        maskedEmail: otp.maskEmail(authEmail),
        expiresInSec: result.expiresInSec,
        resendInSec: Math.floor(otp.RESEND_COOLDOWN_MS / 1000)
      });
    } catch (e) {
      console.error("[auth] request-otp error:", e.message);
      return res.status(500).json({
        success: false,
        error: "Não foi possível processar o pedido."
      });
    }
  });

  app.post("/api/auth/verify-otp", (req, res) => {
    try {
      if (!checkOrigin(req)) {
        return res.status(403).json({ success: false, error: "Pedido rejeitado." });
      }
      const code = req.body && req.body.code;
      const result = otp.verifyOtp(PURPOSE, code);
      if (!result.ok) {
        const msg =
          result.error === "too_many_attempts"
            ? "Demasiadas tentativas. Solicite um novo código."
            : result.error === "already_used"
              ? "Este código já foi utilizado."
              : "Código inválido ou expirado.";
        return res.status(401).json({ success: false, error: msg });
      }

      req.session.regenerate((err) => {
        if (err) {
          console.error("[auth] session regenerate failed");
          return res.status(500).json({
            success: false,
            error: "Não foi possível criar a sessão."
          });
        }
        req.session.authenticated = true;
        req.session.authAt = Date.now();
        req.session.save((saveErr) => {
          if (saveErr) {
            return res.status(500).json({
              success: false,
              error: "Não foi possível guardar a sessão."
            });
          }
          return res.json({ success: true, authenticated: true });
        });
      });
    } catch (e) {
      console.error("[auth] verify-otp error:", e.message);
      return res.status(500).json({
        success: false,
        error: "Não foi possível validar o código."
      });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    if (!req.session) {
      return res.json({ success: true });
    }
    req.session.destroy((err) => {
      res.clearCookie("mlf.sid", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      });
      if (err) {
        return res.status(500).json({ success: false, error: "Falha ao terminar sessão." });
      }
      return res.json({ success: true });
    });
  });
}

module.exports = {
  mountAuthRoutes,
  requireAuth,
  requireAuthPage,
  checkOrigin,
  clientIp
};
