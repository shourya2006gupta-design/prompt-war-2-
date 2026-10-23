/**
 * @jest-environment jsdom
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

import {
  detectEmergencyKeywords,
  updateEmergencyBanner,
  setEmergencyKeywords,
  setEmergencyNumbers,
  setJurisdiction,
  handleAiAnalysisResponse,
} from "../../public/app.js";
import {
  loadEmergencyData,
  getLoadedKeywords,
  getLoadedNumbers,
} from "../../src/services/emergency.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_HTML_PATH = path.resolve(__dirname, "../../public/index.html");

describe("Phase A2: Emergency Safety Layer", () => {
  let htmlContent;

  beforeEach(() => {
    htmlContent = fs.readFileSync(INDEX_HTML_PATH, "utf-8");
    document.documentElement.innerHTML = htmlContent;

    // Reset default test keywords and numbers
    setEmergencyKeywords([
      "electrocuted",
      "electrocution",
      "live wire",
      "gas leak",
      "explosion",
      "trapped",
      "active fire",
    ]);

    setEmergencyNumbers([
      {
        jurisdictionAliases: ["united kingdom", "uk", "england"],
        number: "999",
      },
      {
        jurisdictionAliases: ["australia", "nsw", "sydney"],
        number: "000",
      },
      {
        jurisdictionAliases: ["united states", "usa", "us"],
        number: "911",
      },
    ]);

    setJurisdiction(null, null);
  });

  describe("Static HTML Permanent Emergency Notice (No JS Baseline)", () => {
    test("permanent emergency notice exists in raw HTML without JavaScript execution", () => {
      expect(htmlContent).toContain('id="emergency-notice"');
      const noticeElement = document.getElementById("emergency-notice");
      expect(noticeElement).not.toBeNull();
      expect(noticeElement.textContent).toContain("If anyone is in immediate danger");
    });

    test("permanent emergency notice has role='region' and aria-label", () => {
      const noticeElement = document.getElementById("emergency-notice");
      expect(noticeElement.getAttribute("role")).toBe("region");
      expect(noticeElement.getAttribute("aria-label")).toBe("Emergency safety notice");
    });

    test("permanent notice is strictly country-neutral and contains no universal numbers", () => {
      const noticeElement = document.getElementById("emergency-notice");
      const text = noticeElement.textContent;
      expect(text).not.toContain("999");
      expect(text).not.toContain("000");
      expect(text).not.toContain("911");
      expect(text).toContain("call your local emergency services immediately");
    });

    test("noscript notice exists and is country-neutral", () => {
      expect(htmlContent).toContain("<noscript>");
      expect(htmlContent).toContain("emergency-notice--noscript");
      // Extract noscript block content
      const noscriptMatch = htmlContent.match(/<noscript>([\s\S]*?)<\/noscript>/);
      expect(noscriptMatch).not.toBeNull();
      const noscriptHtml = noscriptMatch[1];
      expect(noscriptHtml).toContain("If this is an emergency, contact your local emergency services immediately");
      expect(noscriptHtml).not.toContain("999");
      expect(noscriptHtml).not.toContain("000");
      expect(noscriptHtml).not.toContain("911");
    });
  });

  describe("Synchronous Emergency Keyword Detection", () => {
    test("detects explicit emergency keywords synchronously", () => {
      expect(detectEmergencyKeywords("someone was electrocuted near the pole")).toBe(true);
      expect(detectEmergencyKeywords("downed live wire sparking on road")).toBe(true);
      expect(detectEmergencyKeywords("severe explosion heard nearby")).toBe(true);
      expect(detectEmergencyKeywords("smell a strong gas leak")).toBe(true);
    });

    test("is case-insensitive", () => {
      expect(detectEmergencyKeywords("ELECTROCUTED")).toBe(true);
      expect(detectEmergencyKeywords("Gas Leak")).toBe(true);
    });

    test("returns false for non-emergency text without drawing safety conclusion", () => {
      expect(detectEmergencyKeywords("large tree branch fallen on sidewalk")).toBe(false);
      expect(detectEmergencyKeywords("pothole in middle lane")).toBe(false);
      expect(detectEmergencyKeywords("")).toBe(false);
      expect(detectEmergencyKeywords(null)).toBe(false);
    });
  });

  describe("Emergency Warning Banner DOM Behavior", () => {
    test("keyword match displays supplementary warning banner with role='alert'", () => {
      const banner = document.getElementById("supplementary-emergency-banner");
      expect(banner.classList.contains("hidden")).toBe(true);

      updateEmergencyBanner(true);

      expect(banner.classList.contains("hidden")).toBe(false);
      expect(banner.getAttribute("role")).toBe("alert");
      expect(banner.getAttribute("aria-live")).toBe("assertive");
    });

    test("keyword non-detection hides banner and NEVER asserts or renders a 'safe' status", () => {
      const banner = document.getElementById("supplementary-emergency-banner");
      // First show banner
      updateEmergencyBanner(true);
      expect(banner.classList.contains("hidden")).toBe(false);

      // Now set non-emergency
      updateEmergencyBanner(false);
      expect(banner.classList.contains("hidden")).toBe(true);

      // Invariant: Non-detection must NEVER render a "safe" or "cleared" label anywhere in DOM
      const pageText = document.body.textContent.toLowerCase();
      expect(pageText).not.toContain("situation is safe");
      expect(pageText).not.toContain("no danger verified");
      expect(pageText).not.toContain("safety cleared");
    });
  });

  describe("Jurisdiction Gating on Emergency Telephone Numbers", () => {
    test("AI_INFERRED jurisdiction NEVER displays specific emergency number", () => {
      // Inferred as United Kingdom, but user has NOT confirmed it
      setJurisdiction("United Kingdom", "AI_INFERRED");

      updateEmergencyBanner(true);

      const body = document.getElementById("supplementary-banner-body");
      expect(body.textContent).toContain("Contact your local emergency services immediately");
      expect(body.textContent).not.toContain("999");
    });

    test("USER_REPORTED confirmed jurisdiction with verified number displays verified number", () => {
      // Explicitly confirmed by user
      setJurisdiction("United Kingdom", "USER_REPORTED");

      updateEmergencyBanner(true);

      const body = document.getElementById("supplementary-banner-body");
      expect(body.textContent).toContain("In United Kingdom: call 999 immediately");
    });

    test("USER_REPORTED confirmed jurisdiction without verified number displays country-neutral guidance", () => {
      // Explicitly confirmed by user, but no verified number exists in database
      setJurisdiction("Iceland", "USER_REPORTED");

      updateEmergencyBanner(true);

      const body = document.getElementById("supplementary-banner-body");
      expect(body.textContent).toContain("Contact your local emergency services immediately");
      expect(body.textContent).not.toContain("call 999");
    });
  });

  describe("Decoupling AI Analysis from Emergency State", () => {
    test("AI response cannot remove, hide, or suppress an active emergency banner", () => {
      const banner = document.getElementById("supplementary-emergency-banner");
      // Trigger emergency banner
      updateEmergencyBanner(true);
      expect(banner.classList.contains("hidden")).toBe(false);

      // Simulate AI response arriving with benign classification
      handleAiAnalysisResponse({
        hazardCategory: "ROAD_DAMAGE",
        urgencyLevel: "LOW",
        incidentSummary: "Minor surface damage",
      });

      // Emergency banner MUST remain active
      expect(banner.classList.contains("hidden")).toBe(false);
    });
  });

  describe("Emergency Dataset Loader Service", () => {
    test("loadEmergencyData loads keywords and numbers datasets", () => {
      const data = loadEmergencyData();
      expect(Array.isArray(data.keywords)).toBe(true);
      expect(Array.isArray(data.numbers)).toBe(true);
      expect(data.keywords.length).toBeGreaterThan(0);
      expect(data.numbers.length).toBeGreaterThan(0);

      expect(getLoadedKeywords()).toEqual(data.keywords);
      expect(getLoadedNumbers()).toEqual(data.numbers);
    });
  });
});
