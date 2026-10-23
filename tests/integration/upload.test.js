import request from "supertest";
import { describe, test, expect, beforeEach } from "@jest/globals";
import sharp from "sharp";
import { createApp } from "../../src/app.js";
import { clearAllSessions } from "../../src/middleware/session.js";

describe("Phase A1: Image Upload Endpoint & Sanitization Pipeline", () => {
  let app;
  let validSessionCookies;
  let csrfToken;

  beforeEach(async () => {
    clearAllSessions();
    app = createApp();

    const initRes = await request(app).get("/").set("X-Forwarded-For", "192.168.20.1");
    validSessionCookies = initRes.headers["set-cookie"];
    const csrfCookie = validSessionCookies.find((c) => c.startsWith("csrf_token="));
    csrfToken = csrfCookie.split(";")[0].split("=")[1];
  });

  test("rejects upload when CSRF token is missing", async () => {
    const pngBuf = await sharp({
      create: { width: 5, height: 5, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const res = await request(app)
      .post("/api/upload")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", validSessionCookies)
      .attach("image", pngBuf, "test.png");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF/i);
  });

  test("rejects request when no file is provided in image field", async () => {
    const res = await request(app)
      .post("/api/upload")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", validSessionCookies)
      .set("X-CSRF-Token", csrfToken);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No image file provided/i);
  });

  test("rejects fake file with fraudulent extension (magic byte check)", async () => {
    const fakeBuffer = Buffer.from("NOT_A_REAL_IMAGE_DATA_JUST_TEXT", "utf-8");

    const res = await request(app)
      .post("/api/upload")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", validSessionCookies)
      .set("X-CSRF-Token", csrfToken)
      .attach("image", fakeBuffer, "exploit.jpg");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported or unrecognized file type/i);
  });

  test("accepts valid image, strips EXIF, and returns sanitized response", async () => {
    const validPng = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 50, g: 150, b: 250 } },
    })
      .png()
      .toBuffer();

    const res = await request(app)
      .post("/api/upload")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", validSessionCookies)
      .set("X-CSRF-Token", csrfToken)
      .attach("image", validPng, "hazard_photo.png");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("fileId");
    expect(res.body).toHaveProperty("mimeType", "image/png");
    expect(res.body).toHaveProperty("storageNotice");
    expect(res.body.originalName).toBe("hazard_photo.png");
    expect(res.body.message).toMatch(/EXIF and GPS metadata removed/i);
  });
});
