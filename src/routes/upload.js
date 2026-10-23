import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { csrfProtection } from "../middleware/csrf.js";
import {
  MAX_FILES_PER_SESSION,
  MAX_SESSION_UPLOAD_STORAGE_BYTES,
  MAX_GLOBAL_UPLOAD_STORAGE_BYTES,
  MAX_FILE_SIZE_BYTES,
  getGlobalUploadStorageBytes,
} from "../middleware/session.js";
import { validateImageMagicBytes, stripImageMetadata } from "../services/image.js";

const router = express.Router();

// Configure Multer with strict in-memory storage and 5 MB per-file limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES, // 5 MB
    files: 1, // Process 1 file per upload request
  },
});

export const UPLOAD_STORAGE_NOTICE =
  "Your uploaded files are held temporarily in server memory and will be lost if the server restarts. Download your report to preserve it.";

/**
 * Custom error handler for Multer upload errors
 */
function handleMulterUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "Payload Too Large: Image file exceeds the maximum allowed size of 5 MB.",
        });
      }
      return res.status(400).json({
        error: `File upload error: ${err.message}`,
      });
    }
    next();
  });
}

/**
 * POST /api/upload
 * Session-bound image upload with magic-byte validation and EXIF/GPS stripping
 */
router.post(
  "/upload",
  uploadLimiter,
  csrfProtection,
  handleMulterUpload,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "Bad Request: No image file provided in 'image' field.",
      });
    }

    if (!req.session) {
      return res.status(500).json({
        error: "Session Error: Active session context is required.",
      });
    }

    if (!req.session.files) {
      req.session.files = new Map();
    }

    // 1. Enforce Per-Session File Count Ceiling (Max 5 files)
    if (req.session.files.size >= MAX_FILES_PER_SESSION) {
      return res.status(429).json({
        error: `Upload Limit Reached: A maximum of ${MAX_FILES_PER_SESSION} images are permitted per session.`,
      });
    }

    // 2. Validate Magic Bytes (True MIME check, not trusting client headers)
    const magicResult = await validateImageMagicBytes(req.file.buffer);
    if (!magicResult.isValid) {
      return res.status(400).json({
        error: magicResult.error,
      });
    }

    try {
      // 3. Strip all EXIF, GPS, and device metadata using sharp
      const sanitizedBuffer = await stripImageMetadata(req.file.buffer);

      // 4. Enforce Per-Session Total Storage Limit (Max 20 MB)
      let currentSessionBytes = 0;
      for (const f of req.session.files.values()) {
        currentSessionBytes += f.sizeBytes || 0;
      }
      if (currentSessionBytes + sanitizedBuffer.length > MAX_SESSION_UPLOAD_STORAGE_BYTES) {
        return res.status(413).json({
          error: "Payload Too Large: Total stored upload size for this session exceeds 20 MB limit.",
        });
      }

      // 5. Enforce Global In-Memory Upload Ceiling (Max 200 MB across all sessions)
      if (getGlobalUploadStorageBytes() + sanitizedBuffer.length > MAX_GLOBAL_UPLOAD_STORAGE_BYTES) {
        return res.status(503).json({
          error: "Service Temporarily Busy: Global upload storage threshold reached. Please try again later.",
        });
      }

      // 6. Generate UUID fileId and bind exclusively to current session
      const fileId = crypto.randomUUID();
      const safeOriginalName = path.basename(req.file.originalname || "image.jpg");

      const fileRecord = {
        id: fileId,
        buffer: sanitizedBuffer,
        mimeType: magicResult.mimeType,
        sizeBytes: sanitizedBuffer.length,
        originalName: safeOriginalName,
        uploadedAt: new Date().toISOString(),
      };

      req.session.files.set(fileId, fileRecord);

      // Return clean response — NEVER leak GPS or internal memory locations
      return res.status(200).json({
        fileId,
        mimeType: magicResult.mimeType,
        sizeBytes: sanitizedBuffer.length,
        originalName: safeOriginalName,
        message: "Image successfully uploaded and sanitized (all EXIF and GPS metadata removed).",
        storageNotice: UPLOAD_STORAGE_NOTICE,
      });
    } catch (err) {
      console.error("[SafeRoute Upload Error]", err);
      return res.status(500).json({
        error: "Failed to process and sanitize image file.",
      });
    }
  }
);

export default router;
