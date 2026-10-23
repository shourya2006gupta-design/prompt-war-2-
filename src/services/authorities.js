import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AuthoritiesListSchema } from "../schemas/authority.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_AUTHORITIES_PATH = path.resolve(__dirname, "../../data/authorities.json");

export const HANDOFF_DISCLAIMER =
  "SafeRoute has not submitted this report on your behalf. You must use the link above to submit your report directly to the responsible authority.";

let loadedAuthorities = [];

/**
 * Normalize text for deliberate alias token matching
 * @param {string} text
 * @returns {string}
 */
export function normalizeJurisdiction(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // strip punctuation
    .replace(/\s+/g, " "); // collapse whitespace
}

/**
 * Load and validate authorities.json from disk
 * @param {string} [filePath]
 */
export function loadAuthorities(filePath = DEFAULT_AUTHORITIES_PATH) {
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Authorities data file not found at: ${filePath}`);
    error.code = "AUTHORITIES_FILE_MISSING";
    throw error;
  }

  try {
    const rawData = fs.readFileSync(filePath, "utf-8");
    const json = JSON.parse(rawData);
    const parsed = AuthoritiesListSchema.parse(json);
    loadedAuthorities = parsed;
    return loadedAuthorities;
  } catch (err) {
    const error = new Error(`Authorities data file is invalid: ${err.message}`);
    error.code = "AUTHORITIES_DATA_INVALID";
    throw error;
  }
}

/**
 * Pure lookup function against curated authorities
 * No AI involvement. Enforces strict jurisdiction confirmation and accepted hazard types.
 * 
 * @param {string|null|undefined} confirmedJurisdiction
 * @param {string} hazardCategory
 * @param {boolean} userExplicitlyConfirmed
 * @returns {{ authorities: any[], noMatchReason?: string, handoffDisclaimer: string }}
 */
export function findAuthorities(confirmedJurisdiction, hazardCategory, userExplicitlyConfirmed = false) {
  if (loadedAuthorities.length === 0 && fs.existsSync(DEFAULT_AUTHORITIES_PATH)) {
    try {
      loadAuthorities();
    } catch {
      // Continue with whatever is loaded
    }
  }

  // 1. Explicit user confirmation requirement
  if (!userExplicitlyConfirmed || !confirmedJurisdiction || confirmedJurisdiction.trim() === "") {
    return {
      authorities: [],
      noMatchReason: "JURISDICTION_CONFIRMATION_REQUIRED",
      handoffDisclaimer: HANDOFF_DISCLAIMER,
    };
  }

  // 2. Reject UNKNOWN hazard type — never guess coverage
  if (hazardCategory === "UNKNOWN") {
    return {
      authorities: [],
      noMatchReason: "HAZARD_TYPE_UNKNOWN_NEEDS_CLARIFICATION",
      handoffDisclaimer: HANDOFF_DISCLAIMER,
    };
  }

  const normalizedInput = normalizeJurisdiction(confirmedJurisdiction);
  const inputTokens = normalizedInput.split(" ").filter(Boolean);

  // 3. Filter only ACTIVE entries
  const activeEntries = loadedAuthorities.filter(entry => entry.availabilityStatus === "ACTIVE");

  // 4. Match against deliberate canonical aliases
  const matched = activeEntries.filter(entry => {
    // Check if hazardCategory is explicitly supported
    if (!entry.acceptedHazardTypes.includes(hazardCategory)) {
      return false;
    }

    // Normalized alias matching: exact string match or exact token set match
    return entry.jurisdictionAliases.some(alias => {
      const normalizedAlias = normalizeJurisdiction(alias);
      if (normalizedInput === normalizedAlias) return true;

      // Check if normalized alias appears as an exact distinct boundary token
      // e.g. "manchester" in "manchester england", but NOT "york" in "new york"
      const aliasTokens = normalizedAlias.split(" ").filter(Boolean);
      return aliasTokens.every(tok => inputTokens.includes(tok));
    });
  });

  if (matched.length === 0) {
    // Determine whether jurisdiction was unrecognized or hazard unsupported
    const jurisdictionKnown = activeEntries.some(entry =>
      entry.jurisdictionAliases.some(alias => {
        const norm = normalizeJurisdiction(alias);
        return normalizedInput === norm || norm.split(" ").every(t => inputTokens.includes(t));
      })
    );

    return {
      authorities: [],
      noMatchReason: jurisdictionKnown ? "HAZARD_TYPE_UNSUPPORTED" : "NO_VERIFIED_DATA",
      handoffDisclaimer: HANDOFF_DISCLAIMER,
    };
  }

  // 5. Order by specificity (locality > region > national)
  matched.sort((a, b) => {
    const scoreA = (a.jurisdiction.locality ? 3 : 0) + (a.jurisdiction.region ? 2 : 0);
    const scoreB = (b.jurisdiction.locality ? 3 : 0) + (b.jurisdiction.region ? 2 : 0);
    return scoreB - scoreA;
  });

  return {
    authorities: matched,
    handoffDisclaimer: HANDOFF_DISCLAIMER,
  };
}
