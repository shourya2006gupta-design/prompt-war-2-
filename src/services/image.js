import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Validate image buffer using magic bytes (not file extension or headers)
 * @param {Buffer} buffer
 * @returns {Promise<{ isValid: boolean, mimeType?: string, ext?: string, error?: string }>}
 */
export async function validateImageMagicBytes(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { isValid: false, error: "Empty or invalid file buffer." };
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    return {
      isValid: false,
      error: "Unsupported or unrecognized file type. Allowed formats: JPEG, PNG, WebP.",
    };
  }

  if (!ALLOWED_IMAGE_MIMES.includes(detected.mime)) {
    return {
      isValid: false,
      mimeType: detected.mime,
      error: `Disallowed file format (${detected.mime}). Allowed formats: JPEG, PNG, WebP.`,
    };
  }

  return {
    isValid: true,
    mimeType: detected.mime,
    ext: detected.ext,
  };
}

/**
 * Strip all EXIF, GPS, camera metadata, and comments from image buffer
 * Preserves correct pixel orientation via .rotate() before stripping
 * 
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function stripImageMetadata(buffer) {
  // sharp automatically strips EXIF, IPTC, XMP metadata when exporting without .withMetadata()
  return await sharp(buffer)
    .rotate() // Auto-orient based on existing EXIF orientation before strip
    .toBuffer();
}

/**
 * Inspect image metadata to verify that EXIF/GPS have been stripped
 * @param {Buffer} buffer
 * @returns {Promise<object>}
 */
export async function inspectImageMetadata(buffer) {
  const meta = await sharp(buffer).metadata();
  return {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    hasExif: !!meta.exif,
    hasIptc: !!meta.iptc,
    hasXmp: !!meta.xmp,
  };
}
