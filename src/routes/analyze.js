import express from "express";
import { AnalyzeRequestSchema } from "../schemas/api.js";
import { analyzeLimiter } from "../middleware/rateLimit.js";
import { csrfProtection } from "../middleware/csrf.js";

const router = express.Router();

router.post("/analyze", analyzeLimiter, csrfProtection, (req, res) => {
  const result = AnalyzeRequestSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: "Validation Error",
      details: result.error.flatten(),
    });
  }

  // Placeholder response for Phase A1 pipeline testing; full Gemini service connected in Phase A3
  return res.status(200).json({
    status: "ok",
    received: {
      messageLength: result.data.message.length,
      hasLocation: Boolean(result.data.locationText),
    },
  });
});

export default router;
