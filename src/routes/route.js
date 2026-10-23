import express from "express";
import { z } from "zod";
import { HazardCategoryEnum } from "../schemas/authority.js";
import { findAuthorities } from "../services/authorities.js";
import { routeLimiter } from "../middleware/rateLimit.js";
import { csrfProtection } from "../middleware/csrf.js";

const router = express.Router();

const RouteRequestSchema = z.object({
  hazardCategory: HazardCategoryEnum,
  confirmedJurisdiction: z.string().trim().min(1).max(200).optional(),
  userExplicitlyConfirmed: z.boolean().default(false),
}).strict();

router.post("/route", routeLimiter, csrfProtection, (req, res) => {
  const parseResult = RouteRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "Validation Error",
      details: parseResult.error.flatten(),
    });
  }

  const { hazardCategory, confirmedJurisdiction, userExplicitlyConfirmed } = parseResult.data;

  // Server derives trust state: if userExplicitlyConfirmed is true, record in session
  if (userExplicitlyConfirmed && confirmedJurisdiction && req.session) {
    req.session.confirmedJurisdiction = confirmedJurisdiction;
  }

  // Pure function lookup (never calls Gemini API)
  const result = findAuthorities(confirmedJurisdiction, hazardCategory, userExplicitlyConfirmed);

  return res.status(200).json(result);
});

export default router;
