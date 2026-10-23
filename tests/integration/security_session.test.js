import request from "supertest";
import { jest, describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { createApp } from "../../src/app.js";
import {
  clearAllSessions,
  MAX_ACTIVE_SESSIONS,
  SESSION_INACTIVITY_MS,
  sweepExpiredSessions,
} from "../../src/middleware/session.js";
import crypto from "crypto";
import { setGenAIClient } from "../../src/services/gemini.js";

const mockAiResponse = {
  hazardCategory: "FALLEN_TREE",
  hazardCategoryConfidence: "HIGH",
  description: "Fallen tree blocking two lanes on high street",
  descriptionConfidence: "HIGH",
  urgencyLevel: "HIGH",
  urgencyConfidence: "HIGH",
  locationText: "High Street",
  locationConfidence: "HIGH",
  inferredJurisdiction: "Camden, London",
  missingCriticalFields: [],
  clarificationQuestions: [],
  incidentSummary: "Fallen tree blocking roadway lanes",
  detectedLanguage: "en",
};

describe("Phase A1: Session and Security Middleware Hardening", () => {
  let app;

  beforeEach(() => {
    clearAllSessions();
    setGenAIClient({
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify(mockAiResponse),
        }),
      },
    });
    app = createApp();
  });

  afterEach(() => {
    setGenAIClient(null);
  });

  describe("Security Headers (Helmet)", () => {
    test("X-Frame-Options is DENY", async () => {
      const res = await request(app).get("/");
      expect(res.headers["x-frame-options"]).toBe("DENY");
    });

    test("X-Content-Type-Options is nosniff", async () => {
      const res = await request(app).get("/");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });
  });

  describe("Session Cookies and Attributes", () => {
    test("initial request receives HttpOnly session cookie and readable csrf_token", async () => {
      const res = await request(app).get("/");
      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();

      const sessionCookie = cookies.find((c) => c.startsWith("session_id="));
      const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));

      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain("HttpOnly");
      expect(sessionCookie).toContain("SameSite=Strict");
      expect(sessionCookie).toContain("Max-Age=1800");

      expect(csrfCookie).toBeDefined();
      expect(csrfCookie).not.toContain("HttpOnly");
      expect(csrfCookie).toContain("SameSite=Strict");
      expect(csrfCookie).toContain("Max-Age=1800");
    });

    test("session cookie sets Secure flag when NODE_ENV is production", async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const prodApp = createApp();
        const res = await request(prodApp).get("/");
        const cookies = res.headers["set-cookie"];
        const sessionCookie = cookies.find((c) => c.startsWith("session_id="));
        expect(sessionCookie).toContain("; Secure");
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
    });

    test("session cookie omits Secure flag when NODE_ENV is development (local HTTP exception)", async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      try {
        const devApp = createApp();
        const res = await request(devApp).get("/");
        const cookies = res.headers["set-cookie"];
        const sessionCookie = cookies.find((c) => c.startsWith("session_id="));
        expect(sessionCookie).not.toContain("; Secure");
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
    });
  });

  describe("Origin Header Validation", () => {
    test("state-changing POST without Origin header returns 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/analyze")
        .send({ message: "Test hazard observation" });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Origin header is required");
    });

    test("state-changing POST with untrusted Origin returns 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://malicious-attacker.com")
        .send({ message: "Test hazard observation" });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("is not authorized");
    });

    test("state-changing POST with authorized Origin proceeds past origin check", async () => {
      // Missing CSRF token will trigger 403 from CSRF layer, demonstrating origin check succeeded
      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .send({ message: "Test hazard observation" });
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Missing required X-CSRF-Token header");
    });
  });

  describe("CSRF Protection (Session-Bound)", () => {
    test("POST without X-CSRF-Token returns 403 Forbidden", async () => {
      // First get a session
      const getRes = await request(app).get("/");
      const cookies = getRes.headers["set-cookie"];

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("Cookie", cookies)
        .send({ message: "Test hazard" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Missing required X-CSRF-Token header");
    });

    test("POST with mismatched X-CSRF-Token returns 403 Forbidden", async () => {
      const getRes = await request(app).get("/");
      const cookies = getRes.headers["set-cookie"];

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("Cookie", cookies)
        .set("X-CSRF-Token", "fake-mismatched-csrf-token")
        .send({ message: "Test hazard" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("CSRF token does not match active session");
    });

    test("POST with valid session-bound X-CSRF-Token succeeds", async () => {
      const getRes = await request(app).get("/");
      const cookies = getRes.headers["set-cookie"];
      const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
      const csrfToken = csrfCookie.split(";")[0].split("=")[1];

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("Cookie", cookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: "Fallen tree blocking two lanes on high street" });

      expect(res.status).toBe(200);
      expect(res.body.hazardCategory).toBeDefined();
    });
  });

  describe("Body Constraints & Security Enforcements", () => {
    test("POST with client-submitted sessionId in body returns 400 Bad Request", async () => {
      const getRes = await request(app).get("/");
      const cookies = getRes.headers["set-cookie"];
      const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
      const csrfToken = csrfCookie.split(";")[0].split("=")[1];

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("Cookie", cookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          sessionId: "client-supplied-session-attempt",
          message: "Attempting to assert session identity",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("'sessionId' field is forbidden in the request body");
    });

    test("POST with JSON body > 50 KB returns 413 Payload Too Large", async () => {
      const getRes = await request(app).get("/");
      const cookies = getRes.headers["set-cookie"];
      const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
      const csrfToken = csrfCookie.split(";")[0].split("=")[1];

      // Create payload exceeding 50 KB
      const largePayload = "x".repeat(55 * 1024);

      const res = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("Cookie", cookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: largePayload });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain("Payload too large");
    });
  });

  describe("In-Memory Session Limit & Exhaustion Defense", () => {
    test("5,001st session triggers ceiling check and returns 503 if cap exceeded", async () => {
      // Directly populate session store up to MAX_ACTIVE_SESSIONS
      const now = Date.now();
      const { sessionMiddleware } = await import("../../src/middleware/session.js");

      // Fill sessions map to maximum with active timestamps
      for (let i = 0; i < MAX_ACTIVE_SESSIONS; i++) {
        const fakeReq = { cookies: {}, headers: {}, body: {} };
        const fakeRes = { cookie: () => {} };
        sessionMiddleware(fakeReq, fakeRes, () => {});
      }

      // 5,001st request should be rejected with 503
      const res = await request(app).get("/");
      expect(res.status).toBe(503);
      expect(res.body.error).toContain("Active session ceiling reached");
    });
  });

  describe("Per-Endpoint Rate Limiting", () => {
    test("11th POST to /api/analyze within 60s returns 429 Too Many Requests", async () => {
      const testIp = "198.51.100.99";
      const getRes = await request(app).get("/").set("X-Forwarded-For", testIp);
      const cookies = getRes.headers["set-cookie"];
      const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
      const csrfToken = csrfCookie.split(";")[0].split("=")[1];

      // Send 10 successful requests
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post("/api/analyze")
          .set("Origin", "http://localhost:3000")
          .set("X-Forwarded-For", testIp)
          .set("Cookie", cookies)
          .set("X-CSRF-Token", csrfToken)
          .send({ message: `Hazard report observation turn ${i}` });
        expect(res.status).toBe(200);
      }

      // 11th request must be rate-limited
      const rateLimitedRes = await request(app)
        .post("/api/analyze")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", testIp)
        .set("Cookie", cookies)
        .set("X-CSRF-Token", csrfToken)
        .send({ message: "Hazard report observation turn 11" });

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.error).toContain("Too many analysis requests");
    });
  });
});
