import express from "express";
import crypto from "crypto";
import { AnalyzeRequestSchema } from "../schemas/api.js";
import { analyzeHazardInput, AiValidationError } from "../services/gemini.js";
import { analyzeLimiter } from "../middleware/rateLimit.js";
import { csrfProtection } from "../middleware/csrf.js";


const router = express.Router();

router.post("/analyze", analyzeLimiter, csrfProtection, async (req, res, next) => {
  // 1. Strict validation of request body
  const result = AnalyzeRequestSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: "Validation Error",
      details: result.error.flatten(),
    });
  }

  const { message, locationText, priorTurns, fileIds } = result.data;

  // Retrieve and bind session files if fileIds are provided
  const images = [];
  if (Array.isArray(fileIds) && fileIds.length > 0) {
    if (!req.session || !req.session.files) {
      return res.status(404).json({
        error: "Not Found: No uploaded files found in current session context.",
      });
    }

    for (const id of fileIds) {
      const fileRecord = req.session.files.get(id);
      if (!fileRecord) {
        return res.status(404).json({
          error: `Not Found: Uploaded file '${id}' was not found or has expired for this session.`,
        });
      }
      images.push({
        buffer: fileRecord.buffer,
        mimeType: fileRecord.mimeType,
      });
    }
  }

  try {
    // 2. Call AI analysis pipeline with strict schema validation and multimodal support
    const structuredReport = await analyzeHazardInput(message, locationText, priorTurns, images);

    // 3. Persist incident in session-scoped storage if session available
    if (req.session) {
      if (!Array.isArray(req.session.incidents)) {
        req.session.incidents = [];
      }
      req.session.incidents.push({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: "AWAITING_USER_REVIEW",
        report: structuredReport,
      });
    }

    // 4. Return server-validated, trust-annotated structured report
    return res.status(200).json(structuredReport);
  } catch (err) {
    if (err instanceof AiValidationError || err.status === 422) {
      return res.status(422).json({
        error: "AI Response Validation Failed: The model output did not satisfy safety or schema constraints.",
        details: err.details || null,
      });
    }

    if (err.status === 503) {
      return res.status(503).json({
        error: "AI service temporarily unavailable. Please try again in a few moments.",
      });
    }

    // Never leak internal API details or stack traces
    console.error("[SafeRoute AI Pipeline Error]", err.message);
    return res.status(500).json({
      error: "An unexpected error occurred during incident analysis.",
    });
  }
});

export default router;
