import { config, getEnvConfig } from "./config/env.js";
import { verifyModelAvailability } from "./services/gemini.js";
import { loadAuthorities } from "./services/authorities.js";
import { loadEmergencyData } from "./services/emergency.js";
import { startSessionCleanupTimer } from "./middleware/session.js";
import { createApp } from "./app.js";

/**
 * Startup routine executing all mandatory pre-flight checks
 */
export async function startServer() {
  console.log("=== SafeRoute Server Initializing ===");

  // 1. Validate environment
  getEnvConfig();

  // 2. Load and validate authorities data file
  try {
    loadAuthorities();
    console.log("[SafeRoute] Authorities dataset validated and loaded.");
  } catch (err) {
    console.error(`[SafeRoute Startup Fatal] ${err.message}`);
    process.exit(1);
  }

  // 3. Load and validate emergency datasets
  try {
    loadEmergencyData();
    console.log("[SafeRoute] Emergency keywords and numbers validated and loaded.");
  } catch (err) {
    console.error(`[SafeRoute Startup Fatal] ${err.message}`);
    process.exit(1);
  }

  // 4. Verify Gemini model availability probe (4xx aborts; timeout logs warning and proceeds)
  try {
    await verifyModelAvailability();
  } catch (err) {
    console.error(`[SafeRoute Startup Fatal] ${err.message}`);
    process.exit(1);
  }

  // 5. Start in-memory session cleanup timer
  startSessionCleanupTimer();

  // 6. Instantiate and start Express application
  const app = createApp();
  const server = app.listen(config.PORT, () => {
    console.log(`[SafeRoute] Server listening on http://localhost:${config.PORT} (NODE_ENV: ${config.NODE_ENV})`);
  });

  return server;
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  startServer().catch((err) => {
    console.error("[SafeRoute Startup Error]", err);
    process.exit(1);
  });
}
