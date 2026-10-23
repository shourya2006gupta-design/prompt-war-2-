/**
 * Netlify serverless function entry point.
 * Wraps the Express app with serverless-http so Netlify Lambda
 * can dispatch HTTP events to the existing Express routing layer.
 *
 * Environment variables required in Netlify UI:
 *   GEMINI_API_KEY  — Gemini API key (required)
 *   GEMINI_MODEL    — optional, defaults to gemini-3.8-flash
 *   ALLOWED_ORIGIN  — your Netlify site URL, e.g. https://my-saferoute.netlify.app
 */

import serverless from "serverless-http";
import { createApp } from "../../src/app.js";
import { loadAuthorities } from "../../src/services/authorities.js";
import { loadEmergencyData } from "../../src/services/emergency.js";
import { startSessionCleanupTimer } from "../../src/middleware/session.js";

// ── One-time initialisation (runs once per cold start) ──────────────────────

let _initialised = false;
let _serverlessHandler = null;

function initialise() {
  if (_initialised) return;

  // Validate that the API key is present; throw clearly if missing
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "GEMINI_API_KEY is not set. " +
        "Add it in Netlify → Site configuration → Environment variables."
    );
  }

  try {
    loadAuthorities();
  } catch (err) {
    throw new Error(`[SafeRoute] Failed to load authorities dataset: ${err.message}`);
  }

  try {
    loadEmergencyData();
  } catch (err) {
    throw new Error(`[SafeRoute] Failed to load emergency datasets: ${err.message}`);
  }

  // Session cleanup timer — safe to run in serverless (fires on warm invocations)
  startSessionCleanupTimer();

  _initialised = true;
}

function getServerlessHandler() {
  if (!_serverlessHandler) {
    initialise();
    const app = createApp();
    _serverlessHandler = serverless(app);
  }
  return _serverlessHandler;
}

// ── Netlify Lambda handler export ────────────────────────────────────────────

export const handler = async (event, context) => {
  // Prevent Lambda from waiting for open connections after the callback
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  try {
    return await getServerlessHandler()(event, context);
  } catch (err) {
    console.error("[SafeRoute Netlify] Cold-start error:", err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Server initialisation failed. Check Netlify function logs.",
      }),
    };
  }
};
