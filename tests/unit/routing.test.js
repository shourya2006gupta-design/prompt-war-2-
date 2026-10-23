import { describe, test, expect, beforeEach } from "@jest/globals";
import path from "path";
import { fileURLToPath } from "url";
import {
  findAuthorities,
  normalizeJurisdiction,
  loadAuthorities,
  HANDOFF_DISCLAIMER,
} from "../../src/services/authorities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.resolve(__dirname, "../../data/authorities.json");

describe("Phase A6: Verified Authority Routing Engine", () => {
  beforeEach(() => {
    loadAuthorities(FIXTURE_PATH);
  });

  describe("Jurisdiction Normalization (Deliberate Alias Matching)", () => {
    test("lowercases, strips punctuation, and collapses whitespace", () => {
      expect(normalizeJurisdiction("  United Kingdom, UK!  ")).toBe("united kingdom uk");
      expect(normalizeJurisdiction("Greater London - Westminster")).toBe("greater london - westminster");
      expect(normalizeJurisdiction("")).toBe("");
      expect(normalizeJurisdiction(null)).toBe("");
      expect(normalizeJurisdiction(undefined)).toBe("");
    });
  });

  describe("Mandatory Jurisdiction Confirmation Gate", () => {
    test("returns JURISDICTION_CONFIRMATION_REQUIRED if userExplicitlyConfirmed is false", () => {
      const result = findAuthorities("England", "ROAD_DAMAGE", false);
      expect(result.authorities).toEqual([]);
      expect(result.noMatchReason).toBe("JURISDICTION_CONFIRMATION_REQUIRED");
      expect(result.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });

    test("returns JURISDICTION_CONFIRMATION_REQUIRED if confirmedJurisdiction is empty or missing", () => {
      const emptyResult = findAuthorities("", "ROAD_DAMAGE", true);
      expect(emptyResult.authorities).toEqual([]);
      expect(emptyResult.noMatchReason).toBe("JURISDICTION_CONFIRMATION_REQUIRED");

      const nullResult = findAuthorities(null, "ROAD_DAMAGE", true);
      expect(nullResult.authorities).toEqual([]);
      expect(nullResult.noMatchReason).toBe("JURISDICTION_CONFIRMATION_REQUIRED");
    });
  });

  describe("Hazard Category Verification & Unknown Hazard Clarification", () => {
    test("rejects UNKNOWN hazard category with HAZARD_TYPE_UNKNOWN_NEEDS_CLARIFICATION", () => {
      const result = findAuthorities("England", "UNKNOWN", true);
      expect(result.authorities).toEqual([]);
      expect(result.noMatchReason).toBe("HAZARD_TYPE_UNKNOWN_NEEDS_CLARIFICATION");
      expect(result.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });

    test("returns HAZARD_TYPE_UNSUPPORTED when jurisdiction is recognized but hazard is unaccepted", () => {
      // uk-national-highways accepts: ROAD_DAMAGE, DANGEROUS_DEBRIS, FLOODING, FALLEN_TREE
      // FIRE_RISK is not accepted by national highways
      const result = findAuthorities("England", "FIRE_RISK", true);
      expect(result.authorities).toEqual([]);
      expect(result.noMatchReason).toBe("HAZARD_TYPE_UNSUPPORTED");
      expect(result.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });
  });

  describe("Matching Verified Authority Records", () => {
    test("matches National Highways (England) for valid hazard and exact alias match", () => {
      const result = findAuthorities("england", "ROAD_DAMAGE", true);
      expect(result.authorities.length).toBeGreaterThanOrEqual(1);

      const top = result.authorities[0];
      expect(top.id).toBe("uk-national-highways");
      expect(top.name).toBe("National Highways (England)");
      expect(top.reportingUrl).toBe("https://report.nationalhighways.co.uk");
      expect(top.contactMethod).toBe("LINK");
      expect(top.integrationStatus).toBe("LINK_ONLY");
      expect(top.verificationSource.verifiedDate).toBe("2026-10-23");
      expect(top.verificationSource.verifiedBy).toBe("SafeRoute Verification Team");
      expect(result.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });

    test("matches when alias tokens are included in composite location string (e.g., 'Camden, London, England')", () => {
      const result = findAuthorities("Camden, London, England", "FALLEN_TREE", true);
      expect(result.authorities.length).toBeGreaterThanOrEqual(1);
      expect(result.authorities[0].id).toBe("uk-national-highways");
    });

    test("matches for 'United Kingdom' alias", () => {
      const result = findAuthorities("United Kingdom", "FLOODING", true);
      expect(result.authorities.length).toBeGreaterThanOrEqual(1);
      expect(result.authorities[0].id).toBe("uk-national-highways");
    });

    test("matches for 'UK' alias", () => {
      const result = findAuthorities("M25 Highway, UK", "DANGEROUS_DEBRIS", true);
      expect(result.authorities.length).toBeGreaterThanOrEqual(1);
      expect(result.authorities[0].id).toBe("uk-national-highways");
    });
  });

  describe("Honest No-Match for Unverified Jurisdictions", () => {
    test("returns NO_VERIFIED_DATA for unverified city or country", () => {
      const result = findAuthorities("Tokyo, Japan", "ROAD_DAMAGE", true);
      expect(result.authorities).toEqual([]);
      expect(result.noMatchReason).toBe("NO_VERIFIED_DATA");
      expect(result.handoffDisclaimer).toBe(HANDOFF_DISCLAIMER);
    });

    test("never fabricates a URL or returns unverified candidates", () => {
      const result = findAuthorities("Atlantis", "FLOODING", true);
      expect(result.authorities).toHaveLength(0);
      expect(result.noMatchReason).toBe("NO_VERIFIED_DATA");
    });
  });

  describe("Mandatory Honest Handoff Disclaimer", () => {
    test("always provides the explicit handoff disclaimer stating SafeRoute has not submitted", () => {
      const matchResult = findAuthorities("England", "ROAD_DAMAGE", true);
      expect(matchResult.handoffDisclaimer).toContain(
        "SafeRoute has not submitted this report on your behalf"
      );

      const noMatchResult = findAuthorities("Nowhere", "ROAD_DAMAGE", true);
      expect(noMatchResult.handoffDisclaimer).toContain(
        "SafeRoute has not submitted this report on your behalf"
      );
    });
  });
});
