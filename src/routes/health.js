import express from "express";
import { config } from "../config/env.js";
import { isModelVerified } from "../services/gemini.js";

const router = express.Router();

router.get("/health", (req, res) => {
  const modelConfigured = Boolean(config.GEMINI_API_KEY && config.GEMINI_MODEL);
  const modelVerified = isModelVerified();

  res.status(200).json({
    status: "ok",
    modelConfigured,
    modelVerified,
  });
});

export default router;
