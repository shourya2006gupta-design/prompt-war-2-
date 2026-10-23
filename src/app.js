import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import compression from "compression";
import { helmetMiddleware, originValidationMiddleware } from "./middleware/security.js";
import { sessionMiddleware } from "./middleware/session.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import healthRouter from "./routes/health.js";
import routeRouter from "./routes/route.js";
import analyzeRouter from "./routes/analyze.js";
import uploadRouter from "./routes/upload.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // 1. Compression (Gzip / Brotli) for maximum network transfer efficiency
  app.use(compression());

  // 2. Security Headers
  app.use(helmetMiddleware);

  // 3. Request body parsing with strict 50 KB limit
  app.use(express.json({ limit: "50kb" }));
  app.use(express.urlencoded({ extended: false, limit: "50kb" }));

  // 4. Cookie parser
  app.use(cookieParser());

  // 5. Origin validation on state-changing requests
  app.use(originValidationMiddleware);

  // 6. Session management (assigns HttpOnly cookie, rejects sessionId in body)
  app.use(sessionMiddleware);

  // 7. Global rate limiter
  app.use(globalLimiter);

  // 8. Static file serving with efficient Cache-Control and ETag headers
  const publicDir = path.resolve(__dirname, "../public");
  const dataDir = path.resolve(__dirname, "../data");

  const staticCacheOptions = {
    maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
    etag: true,
    lastModified: true,
  };

  app.use(express.static(publicDir, staticCacheOptions));

  // Serve only safe public data (emergency datasets) with caching
  app.use(
    "/data/emergency-keywords.json",
    express.static(path.join(dataDir, "emergency-keywords.json"), staticCacheOptions)
  );
  app.use(
    "/data/emergency-numbers.json",
    express.static(path.join(dataDir, "emergency-numbers.json"), staticCacheOptions)
  );

  // 8. API Routes
  app.use("/api", healthRouter);
  app.use("/api", routeRouter);
  app.use("/api", analyzeRouter);
  app.use("/api", uploadRouter);

  // 9. 404 handler for unknown API routes
  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
  });

  // 10. Central error handler
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large" || err.status === 413) {
      return res.status(413).json({ error: "Payload too large. Max body size is 50 KB." });
    }
    console.error("[SafeRoute Error]", err.message);
    res.status(err.status || 500).json({
      error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
  });

  return app;
}

export default createApp;
