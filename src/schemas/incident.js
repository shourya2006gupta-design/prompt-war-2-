import { z } from "zod";
import { HazardCategoryEnum } from "./authority.js";

export const ConfidenceLevelEnum = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const UrgencyLevelEnum = z.enum(["IMMEDIATE", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export const TrustStateEnum = z.enum(["USER_REPORTED", "AI_INFERRED", "USER_VERIFIED"]);

/**
 * Raw AI output schema
 * Enforces strict validation:
 * - Rejects any unexpected fields (.strict())
 * - Rejects coordinates (no lat/lng/coords in schema)
 * - Rejects trust states (AI cannot assign trust state)
 * - Rejects emergency guidance (emergency handled client-side)
 */
export const AnalyzeResponseSchema = z.object({
  hazardCategory: HazardCategoryEnum,
  hazardCategoryConfidence: ConfidenceLevelEnum,
  description: z.string().max(1000),
  descriptionConfidence: ConfidenceLevelEnum,
  urgencyLevel: UrgencyLevelEnum,
  urgencyConfidence: ConfidenceLevelEnum,
  locationText: z.string().max(500).nullable(),
  locationConfidence: ConfidenceLevelEnum,
  inferredJurisdiction: z.string().max(200).nullable(),
  missingCriticalFields: z.array(z.string().max(100)).max(10),
  clarificationQuestions: z.array(z.object({
    id: z.string().uuid(),
    field: z.string().max(100),
    question: z.string().max(300),
  })).max(5),
  incidentSummary: z.string().max(500),
  detectedLanguage: z.string().regex(/^[a-z]{2}$/),
}).strict();

/**
 * IncidentField wrapper with server-assigned trust state
 */
export function createIncidentField(value, confidence, source) {
  return {
    value,
    trustState: "AI_INFERRED",
    source,
    confidence,
    lastModifiedAt: new Date().toISOString(),
  };
}

/**
 * Transform validated AI response into server-assigned trust-annotated response
 * @param {z.infer<typeof AnalyzeResponseSchema>} rawAiOutput
 * @param {string} modelName
 */
export function buildTrustAnnotatedReport(rawAiOutput, modelName) {
  const source = `AI (${modelName})`;

  return {
    hazardCategory: createIncidentField(
      rawAiOutput.hazardCategory,
      rawAiOutput.hazardCategoryConfidence,
      source
    ),
    description: createIncidentField(
      rawAiOutput.description,
      rawAiOutput.descriptionConfidence,
      source
    ),
    urgencyLevel: createIncidentField(
      rawAiOutput.urgencyLevel,
      rawAiOutput.urgencyConfidence,
      source
    ),
    locationText: createIncidentField(
      rawAiOutput.locationText,
      rawAiOutput.locationConfidence,
      source
    ),
    inferredJurisdiction: createIncidentField(
      rawAiOutput.inferredJurisdiction,
      "MEDIUM", // Jurisdiction inference is treated as medium confidence until user confirms
      source
    ),
    missingCriticalFields: rawAiOutput.missingCriticalFields,
    clarificationQuestions: rawAiOutput.clarificationQuestions,
    incidentSummary: rawAiOutput.incidentSummary,
    detectedLanguage: rawAiOutput.detectedLanguage,
  };
}
