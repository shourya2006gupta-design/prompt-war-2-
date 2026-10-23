import rateLimit from "express-rate-limit";

const keyGenerator = (req) => req.headers["x-forwarded-for"] || req.ip || "127.0.0.1";

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  keyGenerator,
  message: { error: "Too many requests. Please try again in one minute." },
});

export const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  keyGenerator,
  message: { error: "Too many analysis requests. Limit is 10 per minute." },
});

export const routeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  keyGenerator,
  message: { error: "Too many routing requests. Limit is 20 per minute." },
});
