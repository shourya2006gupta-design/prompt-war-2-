import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest, describe, test, expect, beforeEach, afterAll } from "@jest/globals";
import { getEnvConfig } from "../../src/config/env.js";
import { loadAuthorities } from "../../src/services/authorities.js";
import { loadEmergencyData } from "../../src/services/emergency.js";
import { setModelVerified, isModelVerified } from "../../src/services/gemini.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Phase A0: Scaffold & Startup Pre-flight Checks", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Environment Configuration & Validation", () => {
    test("aborts if GEMINI_API_KEY is absent", () => {
      delete process.env.GEMINI_API_KEY;
      expect(() => getEnvConfig()).toThrow("GEMINI_API_KEY is required");
    });

    test("aborts if GEMINI_API_KEY is empty string", () => {
      process.env.GEMINI_API_KEY = "   ";
      expect(() => getEnvConfig()).toThrow("GEMINI_API_KEY is required");
    });

    test("loads successfully when GEMINI_API_KEY is provided", () => {
      process.env.GEMINI_API_KEY = "ai-valid-test-key";
      process.env.GEMINI_MODEL = "gemini-3.8-flash";
      const cfg = getEnvConfig();
      expect(cfg.GEMINI_API_KEY).toBe("ai-valid-test-key");
      expect(cfg.GEMINI_MODEL).toBe("gemini-3.8-flash");
    });
  });

  describe("Authorities Dataset Validation", () => {
    test("loads valid authorities.json successfully", () => {
      const authorities = loadAuthorities();
      expect(Array.isArray(authorities)).toBe(true);
      expect(authorities.length).toBeGreaterThan(0);
      expect(authorities[0].availabilityStatus).toBe("ACTIVE");
    });

    test("aborts if authorities.json is missing", () => {
      expect(() => loadAuthorities("/nonexistent/path/authorities.json")).toThrow(
        "Authorities data file not found"
      );
    });

    test("aborts if authorities.json is malformed", () => {
      const tempPath = path.resolve(__dirname, "temp-invalid-authorities.json");
      fs.writeFileSync(tempPath, JSON.stringify([{ id: "invalid-entry-missing-fields" }]));
      try {
        expect(() => loadAuthorities(tempPath)).toThrow("Authorities data file is invalid");
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    });
  });

  describe("Emergency Datasets Validation", () => {
    test("loads emergency keywords and numbers successfully", () => {
      const data = loadEmergencyData();
      expect(Array.isArray(data.keywords)).toBe(true);
      expect(data.keywords.length).toBeGreaterThan(0);
      expect(Array.isArray(data.numbers)).toBe(true);
      expect(data.numbers.length).toBeGreaterThan(0);
    });

    test("aborts if emergency-keywords.json is missing", () => {
      expect(() =>
        loadEmergencyData("/nonexistent/keywords.json")
      ).toThrow("Emergency keywords file not found");
    });

    test("aborts if emergency-numbers.json is missing", () => {
      const validKeywordsPath = path.resolve(__dirname, "../../data/emergency-keywords.json");
      expect(() =>
        loadEmergencyData(validKeywordsPath, "/nonexistent/numbers.json")
      ).toThrow("Emergency numbers file not found");
    });
  });

  describe("Model Availability State & Telemetry", () => {
    test("tracks verified model state accurately", () => {
      setModelVerified(true);
      expect(isModelVerified()).toBe(true);
      setModelVerified(false);
      expect(isModelVerified()).toBe(false);
    });

    test("verifyModelAvailability handles 4xx configuration error as fatal abort", async () => {
      const { verifyModelAvailability, setGenAIClient } = await import("../../src/services/gemini.js");
      const error400 = new Error("API key invalid");
      error400.status = 400;

      const mockClient = {
        models: {
          get: jest.fn().mockRejectedValue(error400),
        },
      };

      setGenAIClient(mockClient);
      try {
        await expect(verifyModelAvailability(100)).rejects.toThrow("Fatal: Configured model");
      } finally {
        setGenAIClient(null);
      }
    });

    test("verifyModelAvailability handles timeout gracefully with warning and modelVerified=false", async () => {
      const { verifyModelAvailability, setGenAIClient, isModelVerified } = await import("../../src/services/gemini.js");
      const mockHangingClient = {
        models: {
          get: jest.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500))),
        },
      };

      setGenAIClient(mockHangingClient);
      try {
        const result = await verifyModelAvailability(50);
        expect(result).toBe(false);
        expect(isModelVerified()).toBe(false);
      } finally {
        setGenAIClient(null);
      }
    });
  });
});
