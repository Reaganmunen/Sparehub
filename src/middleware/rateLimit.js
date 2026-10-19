'use strict';

const rateLimit = require('express-rate-limit');

const tooMany = (message, code) => (req, res) => res.status(429).json({ error: { message, code } });

/** Stops password guessing from one computer: 10 login attempts per 15 minutes. (The per-account lockout is separate.) */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: tooMany('Too many login attempts. Wait a few minutes and try again.', 'RATE_LIMITED'),
});

/**
 * A general safety net for the whole API: 600 requests per minute per IP.
 * Both shops sit behind one internet connection (one IP), so keep this generous.
 * Do NOT put it on the M-Pesa callback: Safaricom must always get through.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooMany('Too many requests. Slow down a little.', 'RATE_LIMITED'),
});

module.exports = { loginLimiter, apiLimiter };
