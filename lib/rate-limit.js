"use strict";

/**
 * Simple in-memory sliding-window rate limiter (single process).
 * Not shared across multiple instances — use Redis for multi-node.
 */

function createRateLimiter(options) {
  const windowMs = options.windowMs || 60 * 1000;
  const max = options.max || 30;
  const hits = new Map();

  function prune(now) {
    for (const [key, times] of hits.entries()) {
      const kept = times.filter((t) => now - t < windowMs);
      if (!kept.length) hits.delete(key);
      else hits.set(key, kept);
    }
  }

  return function rateLimit(key) {
    const now = Date.now();
    if (hits.size > 5000) prune(now);
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      const retryAfterSec = Math.ceil((list[0] + windowMs - now) / 1000);
      return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    list.push(now);
    hits.set(key, list);
    return { ok: true, remaining: Math.max(0, max - list.length) };
  };
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim().slice(0, 128);
  return (req.ip || "unknown").slice(0, 128);
}

module.exports = { createRateLimiter, clientIp };
