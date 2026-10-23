import dotenv from "dotenv";
dotenv.config();

/**
 * Validates and exports environment configuration
 */
export function getEnvConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    const error = new Error("GEMINI_API_KEY is required. Set it in .env.");
    error.code = "CONFIG_MISSING_API_KEY";
    throw error;
  }

  return {
    PORT: parseInt(process.env.PORT || "3000", 10),
    NODE_ENV: process.env.NODE_ENV || "development",
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || "http://localhost:3000",
    GEMINI_API_KEY: apiKey.trim(),
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  };
}

export const config = (() => {
  // Allow importing in test environments without immediately aborting if mocked later
  if (process.env.NODE_ENV === "test" && !process.env.GEMINI_API_KEY) {
    return {
      PORT: 3000,
      NODE_ENV: "test",
      ALLOWED_ORIGIN: "http://localhost:3000",
      GEMINI_API_KEY: "test-key-mock",
      GEMINI_MODEL: "gemini-3.8-flash",
    };
  }
  return getEnvConfig();
})();
