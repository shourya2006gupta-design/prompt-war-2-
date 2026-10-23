import request from "supertest";
import { createApp } from "../../src/app.js";
import { setModelVerified } from "../../src/services/gemini.js";

describe("Phase A0: Integration & Server Serving", () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  test("serves index.html on root path with HTML content", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("SafeRoute");
    expect(res.text).toContain("If anyone is in immediate danger");
  });

  test("serves index.css with CSS content", async () => {
    const res = await request(app).get("/index.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/css/);
  });

  test("serves app.js with JavaScript content", async () => {
    const res = await request(app).get("/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
  });

  test("GET /api/health returns operational telemetry distinguishing configured from verified", async () => {
    setModelVerified(true);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      modelConfigured: true,
      modelVerified: true,
    });

    setModelVerified(false);
    const resUnverified = await request(app).get("/api/health");
    expect(resUnverified.status).toBe(200);
    expect(resUnverified.body).toEqual({
      status: "ok",
      modelConfigured: true,
      modelVerified: false,
    });
  });

  test("includes required security headers (Helmet)", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("sets secure HttpOnly session cookie and readable csrf_token cookie on initial request", async () => {
    const res = await request(app).get("/");
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();

    const sessionCookie = setCookie.find((c) => c.startsWith("session_id="));
    const csrfCookie = setCookie.find((c) => c.startsWith("csrf_token="));

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Strict");

    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).toContain("SameSite=Strict");
  });
});
