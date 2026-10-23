import request from "supertest";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import crypto from "crypto";
import { createApp } from "../../src/app.js";
import { setGenAIClient } from "../../src/services/gemini.js";
import { clearAllSessions } from "../../src/middleware/session.js";

describe("Phase A3: AI Analysis Pipeline & Server Schema Validation", () => {
  let app;
  let validSessionCookies;
  let csrfToken;

  const validAiRawResponse = {
    hazardCategory: "ROAD_DAMAGE",
    hazardCategoryConfidence: "HIGH",
    description: "Deep pothole spanning approximately 2 feet in the middle lane of Oxford Street.",
    descriptionConfidence: "HIGH",
    urgencyLevel: "MEDIUM",
    urgencyConfidence: "HIGH",
    locationText: "Oxford Street near Regent Street, London",
    locationConfidence: "HIGH",
    inferredJurisdiction: "London, England",
    missingCriticalFields: [],
    clarificationQuestions: [
      {
        id: crypto.randomUUID(),
        field: "trafficDisruption",
        question: "Is the pothole currently causing vehicle damage or lane blockage?",
      },
    ],
    incidentSummary: "Hazardous pothole in middle lane requiring resurfacing.",
    detectedLanguage: "en",
  };

  beforeEach(async () => {
    clearAllSessions();
    app = createApp();

    // Establish a session and obtain cookies + CSRF token
    const initRes = await request(app).get("/").set("X-Forwarded-For", "192.168.10.1");
    validSessionCookies = initRes.headers["set-cookie"];
    const csrfCookie = validSessionCookies.find((c) => c.startsWith("csrf_token="));
    csrfToken = csrfCookie.split(";")[0].split("=")[1];
  });

  afterEach(() => {
    setGenAIClient(null);
  });

  describe("Request Schema Validation", () => {
    test("rejects request when message field is absent (400)", async () => {
      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.2")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ locationText: "Main Street" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation Error");
      expect(res.body.details.fieldErrors.message).toBeDefined();
    });

    test("rejects request when message exceeds 2,000 characters (400)", async () => {
      const longMessage = "a".repeat(2001);
      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.3")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: longMessage });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation Error");
      expect(res.body.details.fieldErrors.message).toBeDefined();
    });

    test("rejects request containing unknown body fields (.strict()) (400)", async () => {
      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.4")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          message: "Downed tree on road",
          extraUnknownField: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation Error");
    });
  });

  describe("AI Response Schema & Boundary Validation", () => {
    test("valid AI response returns 200 with server-assigned trust states", async () => {
      const mockClient = {
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: JSON.stringify(validAiRawResponse),
          }),
        },
      };
      setGenAIClient(mockClient);

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.5")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          message: "Deep pothole spanning approximately 2 feet on Oxford Street.",
          locationText: "Oxford Street, London",
        });

      expect(res.status).toBe(200);

      // Verify server-side trust state wrapping
      expect(res.body.hazardCategory).toEqual({
        value: "ROAD_DAMAGE",
        confidence: "HIGH",
        trustState: "AI_INFERRED",
        source: expect.stringContaining("AI ("),
        lastModifiedAt: expect.any(String),
      });

      expect(res.body.description).toEqual({
        value: validAiRawResponse.description,
        confidence: "HIGH",
        trustState: "AI_INFERRED",
        source: expect.stringContaining("AI ("),
        lastModifiedAt: expect.any(String),
      });

      expect(res.body.inferredJurisdiction).toEqual({
        value: "London, England",
        confidence: "MEDIUM",
        trustState: "AI_INFERRED",
        source: expect.stringContaining("AI ("),
        lastModifiedAt: expect.any(String),
      });

      expect(res.body.incidentSummary).toBe(validAiRawResponse.incidentSummary);
      expect(res.body.detectedLanguage).toBe("en");
    });

    test("AI response missing required field causes 422 Unprocessable Entity", async () => {
      const invalidResponse = { ...validAiRawResponse };
      delete invalidResponse.hazardCategory; // required field missing

      const mockClient = {
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: JSON.stringify(invalidResponse),
          }),
        },
      };
      setGenAIClient(mockClient);

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.6")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: "Tree down on road" });

      expect(res.status).toBe(422);
      expect(res.body.error).toContain("AI Response Validation Failed");
    });

    test("AI response containing forbidden coordinate fields causes 422 Unprocessable Entity", async () => {
      const responseWithCoords = {
        ...validAiRawResponse,
        coordinates: { lat: 51.5074, lng: -0.1278 }, // coordinates forbidden in schema!
      };

      const mockClient = {
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: JSON.stringify(responseWithCoords),
          }),
        },
      };
      setGenAIClient(mockClient);

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.7")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: "Tree down on road" });

      expect(res.status).toBe(422);
      expect(res.body.error).toContain("AI Response Validation Failed");
    });

    test("AI response with extra unauthorized field rejected by .strict() (422)", async () => {
      const responseWithExtra = {
        ...validAiRawResponse,
        unauthorizedField: "hacked",
      };

      const mockClient = {
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: JSON.stringify(responseWithExtra),
          }),
        },
      };
      setGenAIClient(mockClient);

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.8")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: "Tree down on road" });

      expect(res.status).toBe(422);
      expect(res.body.error).toContain("AI Response Validation Failed");
    });
  });

  describe("External Service Failure Handling & Error Sanitization", () => {
    test("Gemini unavailable returns 503 with safe sanitised error message", async () => {
      const mockClient = {
        models: {
          generateContent: jest.fn().mockRejectedValue(new Error("Google GenAI Connection Timeout (internal key secret-abc)")),
        },
      };
      setGenAIClient(mockClient);

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.10.9")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: "Tree down on road" });

      expect(res.status).toBe(503);
      expect(res.body.error).toContain("AI service temporarily unavailable");
      // Must not leak internal stack details or sensitive strings
      expect(JSON.stringify(res.body)).not.toContain("secret-abc");
      expect(JSON.stringify(res.body)).not.toContain("Connection Timeout");
    });
  });
});
