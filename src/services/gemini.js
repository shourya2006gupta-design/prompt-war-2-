import { GoogleGenAI } from "@google/genai";
import { config } from "../config/env.js";

let modelVerified = false;
let genAIInstance = null;

/**
 * Return initialized GoogleGenAI client
 */
export function getGenAIClient() {
  if (!genAIInstance) {
    genAIInstance = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  }
  return genAIInstance;
}

/**
 * Set custom GenAI client (used in tests)
 */
export function setGenAIClient(client) {
  genAIInstance = client;
}

/**
 * Returns whether the configured Gemini model has been verified
 */
export function isModelVerified() {
  return modelVerified;
}

/**
 * Set verification status (used in tests/startup)
 */
export function setModelVerified(status) {
  modelVerified = Boolean(status);
}

/**
 * Validate model availability on startup
 * Disconnects 4xx (fatal config errors) from transient network timeouts
 * @param {number} timeoutMs
 */
export async function verifyModelAvailability(timeoutMs = 5000) {
  const client = getGenAIClient();
  const modelName = config.GEMINI_MODEL;

  try {
    const probePromise = client.models.get({ model: modelName });
    const timeoutPromise = new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        const err = new Error("Model availability check timed out");
        err.name = "TimeoutError";
        err.isTimeout = true;
        reject(err);
      }, timeoutMs);
    });

    await Promise.race([probePromise, timeoutPromise]);
    modelVerified = true;
    console.log(`[SafeRoute] Model '${modelName}' confirmed available via Gemini API.`);
    return true;
  } catch (error) {
    // Check if it's a confirmed 4xx error (API key invalid, model not found, unauthorized)
    const is4xx = (error.status && error.status >= 400 && error.status < 500) ||
                  (error.statusCode && error.statusCode >= 400 && error.statusCode < 500);

    if (is4xx) {
      const fatalError = new Error(`Fatal: Configured model '${modelName}' is invalid or unauthorized (HTTP ${error.status || error.statusCode}).`);
      fatalError.code = "CONFIG_MODEL_UNAVAILABLE";
      fatalError.status = error.status || error.statusCode;
      throw fatalError;
    }

    // Transient network issues or timeouts: warn, do not abort
    modelVerified = false;
    console.warn(`[SafeRoute] Warning: Model availability check timed out or unreachable (${error.message}). Starting with modelVerified=false.`);
    return false;
  }
}
