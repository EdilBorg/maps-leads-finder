"use strict";

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BYTES = 80 * 1024;

function isHttpUrl(value) {
  if (!value || typeof value !== "string") return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

async function researchLead(lead, opts) {
  const enabled =
    opts.enabled === true ||
    String(process.env.MESSAGE_RESEARCH_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    return { ok: false, skipped: true, reason: "research_disabled", notes: [] };
  }
  const website = lead && lead.website ? String(lead.website).trim() : "";
  if (!website || !isHttpUrl(website)) {
    return { ok: false, skipped: true, reason: "no_official_website", notes: [] };
  }
  if (opts.isOfficialWebsite && !opts.isOfficialWebsite(website)) {
    return { ok: false, skipped: true, reason: "website_not_official", notes: [] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await opts.fetch(website, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "MapsLeadsFinder/1.0 (message research)",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!res.ok) {
      return { ok: false, skipped: false, reason: "http_" + res.status, notes: [] };
    }
    const buf = await res.buffer();
    const text = stripHtml(buf.slice(0, MAX_BYTES).toString("utf8"));
    const notes = [];
    if (text.length > 80) {
      notes.push({ source: "official_website", url: website, excerpt: text.slice(0, 1200) });
    }
    return {
      ok: notes.length > 0,
      skipped: false,
      reason: notes.length ? null : "empty_page",
      notes
    };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "timeout" : "fetch_failed";
    return { ok: false, skipped: false, reason: msg, notes: [] };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { researchLead, isHttpUrl, stripHtml };
