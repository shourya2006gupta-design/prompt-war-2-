import helmet from "helmet";
import { config } from "../config/env.js";

/**
 * Helmet security headers middleware
 */
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Allow Google Fonts stylesheet; 'unsafe-inline' retained for runtime style mutations
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      // Allow Google Fonts glyph files
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  frameguard: { action: "deny" },
  noSniff: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

/**
 * Origin validation middleware for state-changing requests.
 *
 * Allowed origins (in priority order):
 *   1. ALLOWED_ORIGIN env var — set this to your production URL in Netlify env vars
 *   2. localhost variants — always allowed in development / test
 *   3. *.netlify.app — Netlify deploy previews (branch and PR previews)
 */
export function originValidationMiddleware(req, res, next) {
  // Only validate on state-changing requests
  const stateChangingMethods = ["POST", "PUT", "PATCH", "DELETE"];
  if (!stateChangingMethods.includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const allowedOrigin = config.ALLOWED_ORIGIN;
  const nodeEnv = process.env.NODE_ENV || "development";

  // Require an Origin header on all mutating requests
  if (!origin) {
    return res.status(403).json({
      error: "Forbidden: Origin header is required on state-changing requests.",
    });
  }

  // Normalize by stripping trailing slash
  const normOrigin = origin.replace(/\/$/, "");
  const normAllowed = allowedOrigin.replace(/\/$/, "");

  // 1. Explicitly configured origin always allowed
  if (normOrigin === normAllowed) {
    return next();
  }

  // 2. Localhost always allowed in non-production environments
  if (
    nodeEnv !== "production" &&
    (normOrigin === "http://localhost:3000" || normOrigin === "http://127.0.0.1:3000")
  ) {
    return next();
  }

  // 3. Netlify deploy-preview and branch-deploy URLs (*.netlify.app)
  //    This allows PR preview deployments to work without manual config.
  if (/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(normOrigin)) {
    return next();
  }

  return res.status(403).json({
    error: `Forbidden: Origin '${origin}' is not authorized.`,
  });
}
