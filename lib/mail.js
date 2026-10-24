"use strict";

const nodemailer = require("nodemailer");

function getMailConfig() {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || ""
  };
}

function isMailConfigured() {
  const c = getMailConfig();
  return !!(c.user && c.pass && !c.pass.includes("colocar_"));
}

function createTransport() {
  const c = getMailConfig();
  return nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass }
  });
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

async function sendOtpEmail(to, code) {
  if (!isMailConfigured()) {
    const err = new Error("SMTP não configurado");
    err.code = "SMTP_NOT_CONFIGURED";
    throw err;
  }
  const c = getMailConfig();
  const transport = createTransport();
  const { text, html } = buildEmailBodies(code);

  const info = await transport.sendMail({
    from: `"Maps Leads Finder" <${c.user}>`,
    to,
    subject: "Código de acesso \u2014 Maps Leads Finder",
    text,
    html
  });

  return { messageId: info.messageId, accepted: info.accepted || [] };
}

module.exports = {
  sendOtpEmail,
  isMailConfigured,
  getMailConfig,
  buildEmailBodies,
  createTransport
};
