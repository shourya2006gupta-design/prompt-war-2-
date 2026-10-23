/**
 * @jest-environment jsdom
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, test, expect, beforeEach } from "@jest/globals";
import axe from "axe-core";
import {
  handleAiAnalysisResponse,
  renderJurisdictionSection,
  renderClarificationsSection,
  renderAuthorityRoutingResult,
  handleReportSubmit,
} from "../../public/app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HTML_PATH = path.resolve(__dirname, "../../public/index.html");

describe("Phase A7: Accessibility Audit (WCAG 2.1 AA/AAA & axe-core)", () => {
  let htmlContent;

  beforeEach(() => {
    htmlContent = fs.readFileSync(HTML_PATH, "utf-8");
    document.documentElement.innerHTML = htmlContent;
  });

  describe("Static HTML Landmarks & Structural ARIA", () => {
    test("axe-core audit of index.html passes with zero critical or serious violations", async () => {
      const results = await axe.run(document.body, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      });

      const severeViolations = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      expect(severeViolations).toEqual([]);
    });

    test("includes skip to main content link targeting #main-content", () => {
      const skipLink = document.querySelector(".skip-link");
      expect(skipLink).not.toBeNull();
      expect(skipLink.getAttribute("href")).toBe("#main-content");
      expect(skipLink.textContent.trim()).toBe("Skip to main content");

      const mainContent = document.getElementById("main-content");
      expect(mainContent).not.toBeNull();
      expect(mainContent.tagName.toLowerCase()).toBe("main");
    });

    test("permanent emergency notice is marked with role='region' and aria-label", () => {
      const notice = document.getElementById("emergency-notice");
      expect(notice).not.toBeNull();
      expect(notice.getAttribute("role")).toBe("region");
      expect(notice.getAttribute("aria-label")).toBe("Emergency safety notice");
    });

    test("supplementary keyword emergency banner has role='alert' and assertive aria-live", () => {
      const banner = document.getElementById("supplementary-emergency-banner");
      expect(banner).not.toBeNull();
      expect(banner.getAttribute("role")).toBe("alert");
      expect(banner.getAttribute("aria-live")).toBe("assertive");
    });

    test("analysis live status region has role='status' and polite aria-live", () => {
      const liveRegion = document.getElementById("analysis-live-region");
      expect(liveRegion).not.toBeNull();
      expect(liveRegion.getAttribute("role")).toBe("status");
      expect(liveRegion.getAttribute("aria-live")).toBe("polite");
    });

    test("clarifications box has aria-live='polite' for dynamic announcements", () => {
      const clarBox = document.getElementById("clarifications-container");
      expect(clarBox).not.toBeNull();
      expect(clarBox.getAttribute("aria-live")).toBe("polite");
    });
  });

  describe("Form Accessibility & Input Validation Feedback", () => {
    test("every form input has an associated accessible label and descriptive help", () => {
      const descInput = document.getElementById("hazard-description");
      expect(descInput).not.toBeNull();
      const descLabel = document.querySelector("label[for='hazard-description']");
      expect(descLabel).not.toBeNull();
      expect(descInput.getAttribute("aria-describedby")).toContain("description-help");
      expect(descInput.getAttribute("aria-describedby")).toContain("description-error");

      const locInput = document.getElementById("hazard-location");
      expect(locInput).not.toBeNull();
      const locLabel = document.querySelector("label[for='hazard-location']");
      expect(locLabel).not.toBeNull();
      expect(locInput.getAttribute("aria-describedby")).toContain("location-help");
      expect(locInput.getAttribute("aria-describedby")).toContain("location-error");
    });

    test("submitting empty form sets aria-invalid='true' and focuses description input", async () => {
      const descInput = document.getElementById("hazard-description");
      descInput.value = "";

      const fakeEvent = { preventDefault: () => {} };
      await handleReportSubmit(fakeEvent);

      expect(descInput.getAttribute("aria-invalid")).toBe("true");

      const descError = document.getElementById("description-error");
      expect(descError.classList.contains("hidden")).toBe(false);
      expect(descError.textContent).toBe("Please provide a description of the hazard.");
      expect(descError.getAttribute("role")).toBe("alert");
    });

    test("typing valid input removes aria-invalid on subsequent submit", async () => {
      const descInput = document.getElementById("hazard-description");
      descInput.setAttribute("aria-invalid", "true");
      descInput.value = "Fallen power cable sparking on sidewalk";

      // Mock fetch for /api/analyze
      global.fetch = () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              hazardCategory: { value: "UTILITY_LINE_DOWN", trustState: "AI_INFERRED" },
              description: { value: "Fallen power cable sparking", trustState: "AI_INFERRED" },
              urgencyLevel: { value: "IMMEDIATE", trustState: "AI_INFERRED" },
              locationText: { value: "High Street", trustState: "AI_INFERRED" },
              inferredJurisdiction: { value: "London", trustState: "AI_INFERRED" },
              incidentSummary: "Hazardous live wire on walkway.",
            }),
        });

      const fakeEvent = { preventDefault: () => {} };
      await handleReportSubmit(fakeEvent);

      expect(descInput.getAttribute("aria-invalid")).toBeNull();
    });
  });

  describe("Dynamic Content Accessibility (axe-core on Structured Review DOM)", () => {
    test("rendered incident review card passes axe-core accessibility checks", async () => {
      const mockReport = {
        hazardCategory: { value: "ROAD_DAMAGE", trustState: "AI_INFERRED", source: "AI" },
        description: { value: "Pothole in road", trustState: "AI_INFERRED", source: "AI" },
        urgencyLevel: { value: "MEDIUM", trustState: "AI_INFERRED", source: "AI" },
        locationText: { value: "Oxford Street", trustState: "AI_INFERRED", source: "AI" },
        inferredJurisdiction: { value: "London", trustState: "AI_INFERRED", source: "AI" },
        incidentSummary: "Large pothole in roadway.",
        clarificationQuestions: [
          {
            id: "q-12345",
            field: "depth",
            question: "How deep is the pothole approximately?",
          },
        ],
      };

      handleAiAnalysisResponse(mockReport);
      renderJurisdictionSection(mockReport);
      renderClarificationsSection(mockReport);

      const reviewSection = document.getElementById("incident-results-section");
      expect(reviewSection.classList.contains("hidden")).toBe(false);

      const results = await axe.run(reviewSection, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      });

      const severeViolations = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      expect(severeViolations).toEqual([]);
    });

    test("authority routing result card contains valid aria roles and note markup", async () => {
      const mockRouteResult = {
        authorities: [
          {
            id: "uk-national-highways",
            name: "National Highways (England)",
            reportingUrl: "https://report.nationalhighways.co.uk",
            jurisdiction: { coverageNote: "Motorways and major A-roads" },
            disclaimer: "SafeRoute has not submitted this report on your behalf.",
            verificationSource: {
              verifiedDate: "2026-10-23",
              verifiedBy: "SafeRoute Team",
              url: "https://report.nationalhighways.co.uk",
            },
          },
        ],
        handoffDisclaimer: "SafeRoute has not submitted this report on your behalf.",
      };

      renderAuthorityRoutingResult(mockRouteResult);

      const disclaimerBox = document.querySelector(".authority-disclaimer-box");
      expect(disclaimerBox).not.toBeNull();
      expect(disclaimerBox.getAttribute("role")).toBe("note");

      const link = document.querySelector(".authority-link");
      expect(link).not.toBeNull();
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    });
  });
});
