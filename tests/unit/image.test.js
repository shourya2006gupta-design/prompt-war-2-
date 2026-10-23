import { describe, test, expect } from "@jest/globals";
import sharp from "sharp";
import {
  validateImageMagicBytes,
  stripImageMetadata,
  inspectImageMetadata,
  ALLOWED_IMAGE_MIMES,
} from "../../src/services/image.js";

describe("Phase A1: Image Sanitization & Magic Byte Validation", () => {
  test("accepts valid PNG buffer with correct magic bytes", async () => {
    const pngBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const result = await validateImageMagicBytes(pngBuf);
    expect(result.isValid).toBe(true);
    expect(result.mimeType).toBe("image/png");
    expect(result.ext).toBe("png");
  });

  test("accepts valid JPEG buffer with correct magic bytes", async () => {
    const jpegBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const result = await validateImageMagicBytes(jpegBuf);
    expect(result.isValid).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.ext).toBe("jpg");
  });

  test("accepts valid WebP buffer with correct magic bytes", async () => {
    const webpBuf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .webp()
      .toBuffer();

    const result = await validateImageMagicBytes(webpBuf);
    expect(result.isValid).toBe(true);
    expect(result.mimeType).toBe("image/webp");
  });

  test("rejects non-image buffer disguised as image", async () => {
    const fakeBuffer = Buffer.from("<html><script>alert(1)</script></html>", "utf-8");
    const result = await validateImageMagicBytes(fakeBuffer);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/Unsupported or unrecognized file type/i);
  });

  test("rejects null or empty buffer", async () => {
    const emptyResult = await validateImageMagicBytes(Buffer.alloc(0));
    expect(emptyResult.isValid).toBe(false);
    expect(emptyResult.error).toMatch(/Empty or invalid file buffer/i);

    const nullResult = await validateImageMagicBytes(null);
    expect(nullResult.isValid).toBe(false);
  });

  test("stripImageMetadata strips EXIF/GPS and preserves image readability", async () => {
    const baseBuf = await sharp({
      create: { width: 12, height: 12, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg()
      .toBuffer();

    const sanitized = await stripImageMetadata(baseBuf);
    expect(Buffer.isBuffer(sanitized)).toBe(true);
    expect(sanitized.length).toBeGreaterThan(0);

    const meta = await inspectImageMetadata(sanitized);
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(12);
    expect(meta.height).toBe(12);
    expect(meta.hasExif).toBe(false);
    expect(meta.hasIptc).toBe(false);
    expect(meta.hasXmp).toBe(false);
  });
});
