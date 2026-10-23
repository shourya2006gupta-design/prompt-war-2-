import { z } from "zod";
import { HazardCategoryEnum } from "./authority.js";

/**
 * Schema for POST /api/analyze request body
 * Enforces strict limits: no unexpected fields allowed (.strict())
 */
export const AnalyzeRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  locationText: z.string().trim().max(500).optional(),
  priorTurns: z.array(z.object({
    role: z.enum(["user", "model"]),
    text: z.string().max(500),
  })).max(4).optional(),
  fileIds: z.array(z.string().uuid()).max(5).optional(),
}).strict();

/**
 * Schema for POST /api/route request body
 * Strictly models user input actions; rejects client-supplied trust states
 */
export const RouteRequestSchema = z.object({
  hazardCategory: HazardCategoryEnum,
  confirmedJurisdiction: z.string().trim().min(1).max(200).optional(),
  userExplicitlyConfirmed: z.boolean().default(false),
}).strict();
