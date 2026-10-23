import { z } from "zod";

export const HazardCategoryEnum = z.enum([
  "FLOODING",
  "FALLEN_TREE",
  "ROAD_DAMAGE",
  "UTILITY_LINE_DOWN",
  "DANGEROUS_DEBRIS",
  "STRUCTURAL_DAMAGE",
  "FIRE_RISK",
  "WATER_LEAK",
  "SINKHOLES",
  "OTHER_INFRASTRUCTURE",
  "UNKNOWN"
]);

export const AuthoritySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  jurisdiction: z.object({
    countryCode: z.string().length(2),
    region: z.string().nullable(),
    locality: z.string().nullable(),
    coverageNote: z.string().min(1),
  }),
  jurisdictionAliases: z.array(z.string().min(1)),
  acceptedHazardTypes: z.array(HazardCategoryEnum).min(1),
  contactMethod: z.literal("LINK"),
  reportingUrl: z.string().url(),
  verificationSource: z.object({
    url: z.string().url(),
    pageTitle: z.string().min(1),
    verifiedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    verifiedBy: z.string().min(1),
  }),
  integrationStatus: z.literal("LINK_ONLY"),
  disclaimer: z.string().min(1),
  availabilityStatus: z.enum(["ACTIVE", "UNAVAILABLE"]),
}).strict();

export const AuthoritiesListSchema = z.array(AuthoritySchema);
