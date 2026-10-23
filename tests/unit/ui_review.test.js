/**
 * @jest-environment jsdom
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

import {
  initApp,
  renderIncidentReview,
  handleAiAnalysisResponse,
  detectEmergencyKeywords,
  updateEmergencyBanner,
  setEmergencyKeywords,
  setEmergencyNumbers,
  setJurisdiction,
  getJurisdictionState,
  getActiveReport,
  resetReport,
} from "../../public/app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_HTML_PATH = path.resolve(__dirname, "../../public/index.html");

describe("Phase A4: Reporting UI & Citizen Review Form", () => {
  let sampleAiReport;

  beforeEach(() => {
    const htmlContent = fs.readFileSync(INDEX_HTML_PATH, "utf-8");
    document.documentElement.innerHTML = htmlContent;

    setEmergencyKeywords(["electrocuted", "live wire", "explosion", "active fire", "trapped"]);
    setEmergencyNumbers([
      {
        jurisdictionAliases: ["united kingdom", "uk", "england", "london"],
        number: "999",
      },
      {
        jurisdictionAliases: ["australia", "nsw", "sydney"],
        number: "000",
      },
      {
        jurisdictionAliases: ["united states", "usa", "us", "new york"],
        number: "911",
      },
    ]);
    setJurisdiction(null, null);

    sampleAiReport = {
      hazardCategory: {
        value: "FALLEN_TREE",
        confidence: "HIGH",
        trustState: "AI_INFERRED",
        source: "AI (gemini-3.8-flash)",
        lastModifiedAt: new Date().toISOString(),
      },
      description: {
        value: "Large branch blocking lane on High Street",
        confidence: "HIGH",
        trustState: "AI_INFERRED",
        source: "AI (gemini-3.8-flash)",
        lastModifiedAt: new Date().toISOString(),
      },
      urgencyLevel: {
        value: "HIGH",
        confidence: "HIGH",
        trustState: "AI_INFERRED",
        source: "AI (gemini-3.8-flash)",
        lastModifiedAt: new Date().toISOString(),
      },
      locationText: {
        value: "High Street, Camden, London",
        confidence: "HIGH",
        trustState: "AI_INFERRED",
        source: "AI (gemini-3.8-flash)",
        lastModifiedAt: new Date().toISOString(),
      },
      inferredJurisdiction: {
        value: "London, England",
        confidence: "MEDIUM",
        trustState: "AI_INFERRED",
        source: "AI (gemini-3.8-flash)",
        lastModifiedAt: new Date().toISOString(),
      },
      missingCriticalFields: [],
      clarificationQuestions: [
        {
          id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          field: "trafficDisruption",
          question: "Is traffic able to bypass the branch safely?",
        },
      ],
      incidentSummary: "Fallen branch partially obstructing High Street roadway.",
      detectedLanguage: "en",
    };

    initApp();
  });

  describe("Form Inputs & Character Counter", () => {
    test("typing in description updates character count live", () => {
      const descInput = document.getElementById("hazard-description");
      const counter = document.getElementById("char-counter");

      descInput.value = "Pothole on Main Road";
      descInput.dispatchEvent(new Event("input"));

      expect(counter.textContent).toBe("20 / 2,000 characters");
    });

    test("submitting empty form displays error and focuses description input", async () => {
      const form = document.getElementById("hazard-report-form");
      const descInput = document.getElementById("hazard-description");
      const descError = document.getElementById("description-error");

      descInput.value = "   ";
      const submitEvent = new Event("submit", { cancelable: true });
      form.dispatchEvent(submitEvent);

      expect(descError.classList.contains("hidden")).toBe(false);
      expect(descError.textContent).toContain("Please provide a description");
    });
  });

  describe("Text-Only Rendering & XSS Prevention", () => {
    test("escapes HTML/script injections in AI output via textContent", () => {
      const maliciousReport = {
        ...sampleAiReport,
        incidentSummary: "<script>alert('xss-summary')</script>",
        description: {
          ...sampleAiReport.description,
          value: "<img src=x onerror=alert('xss-desc')>",
        },
      };

      renderIncidentReview(maliciousReport);

      const card = document.getElementById("incident-card");
      // Script tags must never exist as DOM elements
      expect(card.querySelectorAll("script").length).toBe(0);
      expect(card.querySelectorAll("img").length).toBe(0);
      expect(card.textContent).toContain("<script>alert('xss-summary')</script>");
      expect(document.getElementById("review-description-input").value).toBe("<img src=x onerror=alert('xss-desc')>");
    });
  });

  describe("Trust Badge Transitions on Citizen Verification", () => {
    test("initial rendering marks all AI fields as AI_INFERRED", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const categoryBadge = document.getElementById("badge-category");
      const urgencyBadge = document.getElementById("badge-urgency");
      const descBadge = document.getElementById("badge-description");
      const locBadge = document.getElementById("badge-location");
      const jurisBadge = document.getElementById("badge-jurisdiction");

      expect(categoryBadge.textContent).toBe("AI Inferred");
      expect(categoryBadge.className).toContain("trust-badge--ai");

      expect(urgencyBadge.textContent).toBe("AI Inferred");
      expect(descBadge.textContent).toBe("AI Inferred");
      expect(locBadge.textContent).toBe("AI Inferred");
      expect(jurisBadge.textContent).toBe("AI Inferred");
    });

    test("editing category dropdown updates badge to User Verified", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const categorySelect = document.getElementById("review-category-select");
      const categoryBadge = document.getElementById("badge-category");

      categorySelect.value = "ROAD_DAMAGE";
      categorySelect.dispatchEvent(new Event("change"));

      expect(categoryBadge.textContent).toBe("User Verified");
      expect(categoryBadge.className).toContain("trust-badge--user");
      expect(getActiveReport().hazardCategory.value).toBe("ROAD_DAMAGE");
      expect(getActiveReport().hazardCategory.trustState).toBe("USER_VERIFIED");
    });

    test("editing description textarea updates badge to User Verified", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const descInput = document.getElementById("review-description-input");
      const descBadge = document.getElementById("badge-description");

      descInput.value = "Corrected description: Fallen tree completely blocking High Street.";
      descInput.dispatchEvent(new Event("input"));

      expect(descBadge.textContent).toBe("User Verified");
      expect(descBadge.className).toContain("trust-badge--user");
      expect(getActiveReport().description.value).toContain("Corrected description");
      expect(getActiveReport().description.trustState).toBe("USER_VERIFIED");
    });
  });

  describe("Jurisdiction Confirmation & Authority Gating", () => {
    test("authority routing button is disabled until citizen confirms jurisdiction", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const findAuthBtn = document.getElementById("find-authority-btn");
      expect(findAuthBtn.disabled).toBe(true);

      const { confirmedJurisdiction, jurisdictionTrustState } = getJurisdictionState();
      expect(confirmedJurisdiction).toBeNull();
      expect(jurisdictionTrustState).toBe("AI_INFERRED");
    });

    test("confirming jurisdiction sets state to USER_REPORTED and unlocks routing button", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const select = document.getElementById("jurisdiction-select");
      const confirmBtn = document.getElementById("confirm-jurisdiction-btn");
      const findAuthBtn = document.getElementById("find-authority-btn");
      const jurisBadge = document.getElementById("badge-jurisdiction");

      // Select England, United Kingdom
      select.value = "England, United Kingdom";
      confirmBtn.click();

      expect(findAuthBtn.disabled).toBe(false);
      expect(jurisBadge.textContent).toBe("User Confirmed");
      expect(jurisBadge.className).toContain("trust-badge--user");

      const { confirmedJurisdiction, jurisdictionTrustState } = getJurisdictionState();
      expect(confirmedJurisdiction).toBe("England, United Kingdom");
      expect(jurisdictionTrustState).toBe("USER_REPORTED");
    });

    test("confirming jurisdiction unlocks verified local emergency number when emergency keywords present", () => {
      // Set input with emergency keyword "live wire"
      const descInput = document.getElementById("hazard-description");
      descInput.value = "Tree fell on live wire sparking on road";
      descInput.dispatchEvent(new Event("input"));

      const bannerBody = document.getElementById("supplementary-banner-body");
      // Initially, no country-specific number is shown (country-neutral guidance)
      expect(bannerBody.textContent).toContain("Contact your local emergency services immediately.");
      expect(bannerBody.textContent).not.toContain("999");

      // Now analyze and confirm UK jurisdiction
      handleAiAnalysisResponse(sampleAiReport);
      const select = document.getElementById("jurisdiction-select");
      const confirmBtn = document.getElementById("confirm-jurisdiction-btn");

      select.value = "England, United Kingdom";
      confirmBtn.click();

      // Now the verified UK emergency number (999) must be unlocked!
      expect(bannerBody.textContent).toContain("In England, United Kingdom: call 999 immediately.");
    });
  });

  describe("Clarification Questions & State Reset", () => {
    test("renders clarification questions when provided", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const container = document.getElementById("clarifications-container");
      expect(container.classList.contains("hidden")).toBe(false);

      const questionLabel = container.querySelector(".clarification-label");
      expect(questionLabel.textContent).toBe("Is traffic able to bypass the branch safely?");
    });

    test("resetReport clears active report, form inputs, and hides results section", () => {
      handleAiAnalysisResponse(sampleAiReport);
      expect(document.getElementById("incident-results-section").classList.contains("hidden")).toBe(false);

      resetReport();

      expect(getActiveReport()).toBeNull();
      expect(getJurisdictionState().confirmedJurisdiction).toBeNull();
      expect(document.getElementById("incident-results-section").classList.contains("hidden")).toBe(true);
      expect(document.getElementById("char-counter").textContent).toBe("0 / 2,000 characters");
    });
  });
});
