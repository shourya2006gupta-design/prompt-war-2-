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
      styleSrc: ["'self'", "'unsafe-inline'"],
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
 * Origin validation middleware for state-changing requests
 */
export function originValidationMiddleware(req, res, next) {
  // Only validate on state-changing requests
  const stateChangingMethods = ["POST", "PUT", "PATCH", "DELETE"];
  if (!stateChangingMethods.includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const allowedOrigin = config.ALLOWED_ORIGIN;

  // In test environment, allow if origin header matches or if localhost
  if (!origin) {
    return res.status(403).json({
      error: "Forbidden: Origin header is required on state-changing requests.",
    });
  }

  // Normalize origins (ignore trailing slash)
  const normOrigin = origin.replace(/\/$/, "");
  const normAllowed = allowedOrigin.replace(/\/$/, "");

  if (normOrigin !== normAllowed && normOrigin !== "http://localhost:3000" && normOrigin !== "http://127.0.0.1:3000") {
    return res.status(403).json({
      error: `Forbidden: Origin '${origin}' is not authorized.`,
    });
  }

  next();
}
