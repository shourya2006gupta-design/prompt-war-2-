/**
 * Session-Bound CSRF Validation Middleware
 */
export function csrfProtection(req, res, next) {
  // Only protect state-changing requests
  const stateChangingMethods = ["POST", "PUT", "PATCH", "DELETE"];
  if (!stateChangingMethods.includes(req.method)) {
    return next();
  }

  const clientToken = req.headers["x-csrf-token"];
  const cookieToken = req.cookies?.csrf_token;
  const sessionToken = req.session?.csrfToken;

  if (!clientToken) {
    return res.status(403).json({
      error: "Forbidden: Missing required X-CSRF-Token header.",
    });
  }

  if (!sessionToken || clientToken !== sessionToken) {
    return res.status(403).json({
      error: "Forbidden: CSRF token does not match active session.",
    });
  }

  if (cookieToken && clientToken !== cookieToken) {
    return res.status(403).json({
      error: "Forbidden: CSRF token cookie mismatch.",
    });
  }

  next();
}
