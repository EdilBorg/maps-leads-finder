"use strict";

const dns = require("dns");
const nodemailer = require("nodemailer");

// Node 17+ may prefer AAAA (IPv6). On many Ubuntu hosts IPv6 resolves
// but SMTP over IPv6 fails or EDNS breaks; IPv4 to smtp.gmail.com:465 works.
try {
  if (typeof dns.setDefaultResultOrder === "function") {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch (_) {
  /* ignore older runtimes */
}

function getMailConfig() {
  const forceIpv4Env = process.env.SMTP_FORCE_IPV4;
  const forceIpv4 =
    forceIpv4Env == null || forceIpv4Env === ""
      ? true
      : String(forceIpv4Env).toLowerCase() !== "false" && forceIpv4Env !== "0";

  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    forceIpv4
  };
}

function isMailConfigured() {
  const c = getMailConfig();
  return !!(c.user && c.pass && !c.pass.includes("colocar_"));
}

/**
 * Prefer IPv4 for SMTP host resolution (avoids EDNS / broken IPv6 paths).
 */
function ipv4Lookup(hostname, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { family: 4, all: false }, (err, address, family) => {
    if (err) {
      return dns.lookup(hostname, options || {}, callback);
    }
    callback(null, address, family);
  });
}

function createTransport() {
  const c = getMailConfig();
  const opts = {
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: {
      user: c.user,
      pass: c.pass
    },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: {
      minVersion: "TLSv1.2",
      servername: c.host
    }
  };

  if (c.forceIpv4) {
    opts.family = 4;
    opts.lookup = ipv4Lookup;
  }

  return nodemailer.createTransport(opts);
}

function buildEmailBodies(code) {
  const text =
    `O seu código de acesso ao Maps Leads Finder é: ${code}\n\n` +
    `Este código expira em 5 minutos e só pode ser usado uma vez.\n\n` +
    `Se não solicitou este código, ignore esta mensagem.\n`;

  const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#0b1220;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1220;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:440px;background:#111827;border:1px solid #1e293b;border-radius:12px;padding:28px;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;letter-spacing:0.04em;text-transform:uppercase;">Maps Leads Finder</p>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#f8fafc;">Código de acesso</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#cbd5e1;">Utilize o código abaixo para entrar. Expira em <strong style="color:#f8fafc;">5 minutos</strong> e é de utilização única.</p>
          <p style="margin:0 0 24px;text-align:center;font-size:32px;letter-spacing:0.35em;font-weight:600;color:#22d3ee;font-family:ui-monospace,Menlo,Consolas,monospace;">${code}</p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">Se não solicitou este código, ignore esta mensagem. Nunca partilhe o código com terceiros.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html };
}

/**
 * Safe error fields for logs (no passwords, tokens, or OTP codes).
 */
function describeSmtpError(err) {
  if (!err || typeof err !== "object") {
    return { message: String(err || "unknown") };
  }
  const out = {};
  if (err.code) out.code = String(err.code);
  if (err.message) {
    out.message = String(err.message)
      .replace(/pass(?:word)?[=:]\s*\S+/gi, "pass=[redacted]")
      .replace(/auth[^=]*=\s*\S+/gi, "auth=[redacted]");
  }
  if (err.command) out.command = String(err.command);
  if (err.responseCode != null) out.responseCode = err.responseCode;
  if (err.response) {
    out.response = String(err.response).slice(0, 300);
  }
  if (err.syscall) out.syscall = String(err.syscall);
  if (err.hostname) out.hostname = String(err.hostname);
  if (err.address) out.address = String(err.address);
  if (err.port) out.port = err.port;
  if (err.cause && typeof err.cause === "object") {
    out.cause = {
      code: err.cause.code ? String(err.cause.code) : undefined,
      message: err.cause.message ? String(err.cause.message).slice(0, 200) : undefined
    };
  }
  return out;
}

async function sendOtpEmail(to, code) {
  if (!isMailConfigured()) {
    const err = new Error("SMTP não configurado");
    err.code = "SMTP_NOT_CONFIGURED";
    throw err;
  }
  const c = getMailConfig();
  const transport = createTransport();
  const { text, html } = buildEmailBodies(code);

  try {
    const info = await transport.sendMail({
      from: `"Maps Leads Finder" <${c.user}>`,
      to,
      subject: "Código de acesso — Maps Leads Finder",
      text,
      html
    });
    return { messageId: info.messageId, accepted: info.accepted || [] };
  } catch (err) {
    const safe = describeSmtpError(err);
    const wrapped = new Error(safe.message || "SMTP send failed");
    wrapped.code = safe.code || "SMTP_SEND_FAILED";
    wrapped.smtp = safe;
    throw wrapped;
  }
}

module.exports = {
  sendOtpEmail,
  isMailConfigured,
  getMailConfig,
  buildEmailBodies,
  createTransport,
  describeSmtpError,
  ipv4Lookup
};
