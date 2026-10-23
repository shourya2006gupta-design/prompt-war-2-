import { z } from "zod";
import { HazardCategoryEnum } from "./authority.js";

export const ConfidenceLevelEnum = z.enum(["HIGH", "MEDIUM", "LOW"]);
export const UrgencyLevelEnum = z.enum(["IMMEDIATE", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
export const TrustStateEnum = z.enum(["USER_REPORTED", "AI_INFERRED", "USER_VERIFIED", "EVIDENCE_SUPPORTED"]);

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
export function createIncidentField(value, confidence, source, trustState = "AI_INFERRED") {
  return {
    value,
    trustState,
    source,
    confidence,
    lastModifiedAt: new Date().toISOString(),
  };
}

/**
 * Transform validated AI response into server-assigned trust-annotated response
 * @param {z.infer<typeof AnalyzeResponseSchema>} rawAiOutput
 * @param {string} modelName
 * @param {boolean} [hasImageEvidence=false]
 */
export function buildTrustAnnotatedReport(rawAiOutput, modelName, hasImageEvidence = false) {
  const baseSource = `AI (${modelName})`;
  const visualSource = hasImageEvidence ? `AI (${modelName}) + Visual Evidence` : baseSource;
  const visualTrustState = hasImageEvidence ? "EVIDENCE_SUPPORTED" : "AI_INFERRED";

  return {
    hazardCategory: createIncidentField(
      rawAiOutput.hazardCategory,
      rawAiOutput.hazardCategoryConfidence,
      visualSource,
      visualTrustState
    ),
    description: createIncidentField(
      rawAiOutput.description,
      rawAiOutput.descriptionConfidence,
      visualSource,
      visualTrustState
    ),
    urgencyLevel: createIncidentField(
      rawAiOutput.urgencyLevel,
      rawAiOutput.urgencyConfidence,
      visualSource,
      visualTrustState
    ),
    locationText: createIncidentField(
      rawAiOutput.locationText,
      rawAiOutput.locationConfidence,
      baseSource,
      "AI_INFERRED"
    ),
    inferredJurisdiction: createIncidentField(
      rawAiOutput.inferredJurisdiction,
      "MEDIUM", // Jurisdiction inference is treated as medium confidence until user confirms
      baseSource,
      "AI_INFERRED"
    ),
    missingCriticalFields: rawAiOutput.missingCriticalFields,
    clarificationQuestions: rawAiOutput.clarificationQuestions,
    incidentSummary: rawAiOutput.incidentSummary,
    detectedLanguage: rawAiOutput.detectedLanguage,
    hasImageEvidence,
  };
}
