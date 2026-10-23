/**
 * @jest-environment jsdom
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

import {
  initApp,
  handleAiAnalysisResponse,
  renderSessionDashboard,
  loadSessionIncidents,
  saveSessionIncidents,
  saveCurrentIncident,
  removeIncidentFromSession,
  clearAllSessionIncidents,
  loadIncidentForReview,
  exportIncidentAsJson,
  setEmergencyKeywords,
  setEmergencyNumbers,
  setJurisdiction,
  getActiveReport,
  getActiveIncidentId,
  getActiveIncidentStatus,
} from "../../public/app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_HTML_PATH = path.resolve(__dirname, "../../public/index.html");

describe("Phase A5: Session Dashboard & Incident Tracking", () => {
  let sampleAiReport;

  beforeEach(() => {
    // Fresh DOM from index.html
    const htmlContent = fs.readFileSync(INDEX_HTML_PATH, "utf-8");
    document.documentElement.innerHTML = htmlContent;

    // Clear sessionStorage
    window.sessionStorage.clear();

    setEmergencyKeywords(["electrocuted", "live wire", "explosion", "active fire", "trapped"]);
    setEmergencyNumbers([
      {
        jurisdictionAliases: ["united kingdom", "uk", "england", "london"],
        number: "999",
      },
    ]);
    setJurisdiction(null, null);

    sampleAiReport = {
      hazardCategory: {
        value: "ROAD_DAMAGE",
        confidence: "HIGH",
        trustState: "AI_INFERRED",
        source: "AI (gemini-3.8-flash)",
        lastModifiedAt: new Date().toISOString(),
      },
      description: {
        value: "Dangerous pothole across northbound lane on Oxford Street.",
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
        value: "Oxford Street near Bond Street, London",
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
      clarificationQuestions: [],
      incidentSummary: "Hazardous road defect on Oxford Street requiring road repair.",
      detectedLanguage: "en",
    };

    initApp();
  });

  describe("Session Storage Lifecycle & Initial Empty State", () => {
    test("initial dashboard displays empty state notice", () => {
      const container = document.getElementById("session-incidents-list");
      const clearBtn = document.getElementById("clear-session-btn");

      expect(container.textContent).toContain("No incidents drafted in this session yet.");
      expect(clearBtn.classList.contains("hidden")).toBe(true);
      expect(loadSessionIncidents()).toEqual([]);
    });

    test("incoming AI report automatically creates a session incident in DRAFT status", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const incidents = loadSessionIncidents();
      expect(incidents.length).toBe(1);
      expect(incidents[0].status).toBe("DRAFT");
      expect(incidents[0].report.hazardCategory.value).toBe("ROAD_DAMAGE");
      expect(getActiveIncidentId()).toBe(incidents[0].id);

      const container = document.getElementById("session-incidents-list");
      const card = container.querySelector(".incident-item-card");
      expect(card).not.toBeNull();
      expect(card.textContent).toContain("Road Damage / Pothole");
      expect(card.textContent).toContain("Draft");

      const clearBtn = document.getElementById("clear-session-btn");
      expect(clearBtn.classList.contains("hidden")).toBe(false);
    });
  });

  describe("Status Transitions & Field Editing Persistence", () => {
    test("confirming jurisdiction advances status to READY_FOR_ROUTING in session storage", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const select = document.getElementById("jurisdiction-select");
      const confirmBtn = document.getElementById("confirm-jurisdiction-btn");

      select.value = "England, United Kingdom";
      confirmBtn.click();

      const incidents = loadSessionIncidents();
      expect(incidents.length).toBe(1);
      expect(incidents[0].status).toBe("READY_FOR_ROUTING");
      expect(incidents[0].report.inferredJurisdiction.value).toBe("England, United Kingdom");
      expect(incidents[0].report.inferredJurisdiction.trustState).toBe("USER_REPORTED");

      const container = document.getElementById("session-incidents-list");
      const statusBadge = container.querySelector(".status-badge");
      expect(statusBadge.textContent).toBe("Ready for Routing");
      expect(statusBadge.className).toContain("status-badge--ready_for_routing");
    });

    test("modifying review fields updates stored session incident with USER_VERIFIED trust state", () => {
      handleAiAnalysisResponse(sampleAiReport);

      const categorySelect = document.getElementById("review-category-select");
      categorySelect.value = "FLOODING";
      categorySelect.dispatchEvent(new Event("change"));

      const incidents = loadSessionIncidents();
      expect(incidents[0].report.hazardCategory.value).toBe("FLOODING");
      expect(incidents[0].report.hazardCategory.trustState).toBe("USER_VERIFIED");

      const container = document.getElementById("session-incidents-list");
      expect(container.textContent).toContain("Flooding / Standing Water");
    });
  });

  describe("Dashboard Operations: View/Edit, Remove, Clear All", () => {
    test("clicking 'View / Edit' restores incident back into active review card", () => {
      handleAiAnalysisResponse(sampleAiReport);

      // Now create a second incident
      const secondReport = {
        ...sampleAiReport,
        hazardCategory: {
          ...sampleAiReport.hazardCategory,
          value: "FALLEN_TREE",
        },
        description: {
          ...sampleAiReport.description,
          value: "Tree down blocking sidewalk",
        },
      };
      handleAiAnalysisResponse(secondReport);

      const incidents = loadSessionIncidents();
      expect(incidents.length).toBe(2);

      // Target the older incident (the road damage one)
      const roadDamageInc = incidents.find(i => i.report.hazardCategory.value === "ROAD_DAMAGE");
      expect(roadDamageInc).toBeDefined();

      // Find the view button corresponding to roadDamageInc
      const card = document.getElementById(`inc-title-${roadDamageInc.id}`).closest(".incident-item-card");
      const viewBtn = card.querySelector(".btn-view-inc");
      viewBtn.click();

      expect(getActiveIncidentId()).toBe(roadDamageInc.id);
      expect(getActiveReport().hazardCategory.value).toBe("ROAD_DAMAGE");
      expect(document.getElementById("review-category-select").value).toBe("ROAD_DAMAGE");
    });

    test("clicking 'Remove' deletes the incident from session storage and refreshes dashboard", () => {
      handleAiAnalysisResponse(sampleAiReport);
      const incidents = loadSessionIncidents();
      const incId = incidents[0].id;

      const card = document.getElementById(`inc-title-${incId}`).closest(".incident-item-card");
      const removeBtn = card.querySelector(".btn-delete-inc");
      removeBtn.click();

      expect(loadSessionIncidents().length).toBe(0);
      const container = document.getElementById("session-incidents-list");
      expect(container.textContent).toContain("No incidents drafted in this session yet.");
    });

    test("clicking 'Clear All Incidents' removes all items and restores empty state", () => {
      handleAiAnalysisResponse(sampleAiReport);
      expect(loadSessionIncidents().length).toBe(1);

      const clearBtn = document.getElementById("clear-session-btn");
      clearBtn.click();

      expect(loadSessionIncidents().length).toBe(0);
      const container = document.getElementById("session-incidents-list");
      expect(container.textContent).toContain("No incidents drafted in this session yet.");
      expect(clearBtn.classList.contains("hidden")).toBe(true);
    });
  });

  describe("Incident Export (JSON)", () => {
    test("exportIncidentAsJson creates schema-compliant export structure", () => {
      const mockCreateObjectURL = jest.fn().mockReturnValue("blob:mock-url");
      const mockRevokeObjectURL = jest.fn();
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      const incident = {
        id: "test-uuid-12345",
        createdAt: "2026-10-23T10:00:00.000Z",
        updatedAt: "2026-10-23T10:05:00.000Z",
        status: "READY_FOR_ROUTING",
        report: sampleAiReport,
      };

      // Mock anchor click
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      exportIncidentAsJson(incident);

      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      const blobPassed = mockCreateObjectURL.mock.calls[0][0];
      expect(blobPassed).toBeInstanceOf(Blob);
      expect(blobPassed.type).toBe("application/json");

      clickSpy.mockRestore();
    });
  });

  describe("XSS Prevention in Dashboard Rendering", () => {
    test("escapes malicious scripts and HTML inside dashboard cards via textContent", () => {
      const maliciousReport = {
        ...sampleAiReport,
        description: {
          ...sampleAiReport.description,
          value: "<script>alert('xss-dashboard')</script><img src=x onerror=alert(1)>",
        },
        inferredJurisdiction: {
          ...sampleAiReport.inferredJurisdiction,
          value: "London <script>hack()</script>",
        },
      };

      handleAiAnalysisResponse(maliciousReport);

      const container = document.getElementById("session-incidents-list");
      expect(container.querySelectorAll("script").length).toBe(0);
      expect(container.querySelectorAll("img").length).toBe(0);
      expect(container.textContent).toContain("<script>alert('xss-dashboard')</script>");
      expect(container.textContent).toContain("London <script>hack()</script>");
    });
  });
});
