import request from "supertest";
import { describe, test, expect, beforeEach } from "@jest/globals";
import { createApp } from "../../src/app.js";
import { clearAllSessions } from "../../src/middleware/session.js";
import { HANDOFF_DISCLAIMER } from "../../src/services/authorities.js";

describe("Phase A6: /api/route Integration Tests", () => {
  let app;
  let validSessionCookies;
  let csrfToken;

  beforeEach(async () => {
    clearAllSessions();
    app = createApp();

    // Establish a session and obtain cookies + CSRF token
    const initRes = await request(app).get("/").set("X-Forwarded-For", "192.168.20.1");
    validSessionCookies = initRes.headers["set-cookie"];
    const csrfCookie = validSessionCookies.find((c) => c.startsWith("csrf_token="));
    csrfToken = csrfCookie.split(";")[0].split("=")[1];
  });

  describe("Security & CSRF Protection", () => {
    test("rejects request missing CSRF token with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.2")
        .set("Cookie", validSessionCookies)
        .send({
          hazardCategory: "ROAD_DAMAGE",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CSRF/i);
    });

    test("rejects request with invalid CSRF token with 403 Forbidden", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.2")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", "invalid-csrf-token-12345")
        .send({
          hazardCategory: "ROAD_DAMAGE",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: true,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CSRF/i);
    });
  });

  describe("Request Schema & Input Validation", () => {
    test("rejects invalid hazardCategory with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.3")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          hazardCategory: "ALIEN_INVASION",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation Error");
    });

    test("rejects unexpected extra body parameters via .strict() with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.3")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          hazardCategory: "ROAD_DAMAGE",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: true,
          unauthorizedField: "malicious_payload",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation Error");
    });
  });

  describe("Routing Matching Behavior & Responses", () => {
    test("returns 200 with matched authority when jurisdiction is confirmed and hazard matches", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.4")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          hazardCategory: "ROAD_DAMAGE",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.authorities).toBeInstanceOf(Array);
      expect(res.body.authorities.length).toBeGreaterThan(0);
      expect(res.body.authorities[0].id).toBe("uk-national-highways");
      expect(res.body.authorities[0].reportingUrl).toBe("https://report.nationalhighways.co.uk");
      expect(res.body.authorities[0].contactMethod).toBe("LINK");
      expect(res.body.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });

    test("returns JURISDICTION_CONFIRMATION_REQUIRED when userExplicitlyConfirmed is false", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.5")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          hazardCategory: "ROAD_DAMAGE",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.authorities).toEqual([]);
      expect(res.body.noMatchReason).toBe("JURISDICTION_CONFIRMATION_REQUIRED");
      expect(res.body.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });

    test("returns HAZARD_TYPE_UNKNOWN_NEEDS_CLARIFICATION when hazardCategory is UNKNOWN", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.6")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          hazardCategory: "UNKNOWN",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.authorities).toEqual([]);
      expect(res.body.noMatchReason).toBe("HAZARD_TYPE_UNKNOWN_NEEDS_CLARIFICATION");
      expect(res.body.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });

    test("returns NO_VERIFIED_DATA for unverified jurisdiction", async () => {
      const res = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", "192.168.20.7")
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          hazardCategory: "ROAD_DAMAGE",
          confirmedJurisdiction: "Sydney, Australia",
          userExplicitlyConfirmed: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.authorities).toEqual([]);
      expect(res.body.noMatchReason).toBe("NO_VERIFIED_DATA");
      expect(res.body.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });
  });

  describe("Route Rate Limiting (20 per minute limit)", () => {
    test("allows up to 20 requests per minute and blocks 21st with 429", async () => {
      const testIp = "192.168.20.88";

      // 20 requests should pass
      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .post("/api/route")
          .set("Origin", "http://localhost:3000")
          .set("X-Forwarded-For", testIp)
          .set("Cookie", validSessionCookies)
          .set("X-CSRF-Token", csrfToken)
          .send({
            hazardCategory: "ROAD_DAMAGE",
            confirmedJurisdiction: "England",
            userExplicitlyConfirmed: true,
          });

        expect(res.status).toBe(200);
      }

      // 21st request should be rate-limited
      const rateLimitedRes = await request(app)
        .post("/api/route")
        .set("Origin", "http://localhost:3000")
        .set("X-Forwarded-For", testIp)
        .set("Cookie", validSessionCookies)
        .set("X-CSRF-Token", csrfToken)
        .send({
          hazardCategory: "ROAD_DAMAGE",
          confirmedJurisdiction: "England",
          userExplicitlyConfirmed: true,
        });

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.error).toMatch(/Too many routing requests/i);
    });
  });
});
