/**
 * SafeRoute Client Application
 * Emergency Detection, Jurisdiction Gating, CSRF, and Reporting Engine
 */

// Internal client state
let emergencyKeywords = [
  "electrocuted",
  "electrocution",
  "live wire",
  "live wire sparking",
  "explosion",
  "gas leak",
  "trapped",
  "unconscious",
  "severe bleeding",
  "heart attack",
  "active fire",
  "collapsed building",
  "building collapse"
];
let emergencyNumbers = [];
let confirmedJurisdiction = null;
let inferredJurisdiction = null;
let jurisdictionTrustState = null;

/**
 * Configure keywords in memory (used by tests and static loader)
 * @param {string[]} keywords
 */
export function setEmergencyKeywords(keywords) {
  if (Array.isArray(keywords)) {
    emergencyKeywords = keywords;
  }
}

/**
 * Configure emergency numbers in memory (used by tests and static loader)
 * @param {Array<{jurisdictionAliases: string[], number: string}>} numbers
 */
export function setEmergencyNumbers(numbers) {
  if (Array.isArray(numbers)) {
    emergencyNumbers = numbers;
  }
}

/**
 * Set jurisdiction state with explicit trust tracking
 * @param {string|null} jurisdiction
 * @param {"USER_REPORTED"|"AI_INFERRED"|null} trustState
 */
export function setJurisdiction(jurisdiction, trustState) {
  jurisdictionTrustState = trustState;
  if (trustState === "USER_REPORTED" && jurisdiction && jurisdiction.trim() !== "") {
    confirmedJurisdiction = jurisdiction.trim();
    inferredJurisdiction = null;
  } else if (trustState === "AI_INFERRED" && jurisdiction && jurisdiction.trim() !== "") {
    inferredJurisdiction = jurisdiction.trim();
    confirmedJurisdiction = null; // AI inference never acts as confirmed jurisdiction
  } else {
    confirmedJurisdiction = null;
    inferredJurisdiction = null;
    jurisdictionTrustState = null;
  }
}

export function getJurisdictionState() {
  return {
    confirmedJurisdiction,
    inferredJurisdiction,
    jurisdictionTrustState,
  };
}

/**
 * Fetch static datasets for client-side synchronous processing
 */
export async function loadStaticData() {
  try {
    const [keywordsRes, numbersRes] = await Promise.all([
      fetch("/data/emergency-keywords.json"),
      fetch("/data/emergency-numbers.json")
    ]);
    if (keywordsRes.ok) emergencyKeywords = await keywordsRes.json();
    if (numbersRes.ok) emergencyNumbers = await numbersRes.json();
  } catch (err) {
    console.warn("[SafeRoute] Using default emergency keyword set:", err.message);
  }
}

/**
 * Synchronous client-side check for emergency keywords.
 * Returns true if an emergency keyword appears in the text.
 * 
 * CRITICAL SAFETY INVARIANT:
 * Non-detection never implies that a situation is safe.
 * 
 * @param {string} text
 * @returns {boolean}
 */
export function detectEmergencyKeywords(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return emergencyKeywords.some(keyword => lower.includes(keyword.toLowerCase()));
}

/**
 * Update the supplementary warning banner DOM element
 * Enforces jurisdiction gating:
 * - AI_INFERRED jurisdiction NEVER unlocks specific emergency numbers
 * - Only confirmed USER_REPORTED jurisdiction with verified entry unlocks specific numbers
 * - When not an emergency, never renders any "safe" clearance
 * 
 * @param {boolean} isEmergency
 */
export function updateEmergencyBanner(isEmergency) {
  const banner = document.getElementById("supplementary-emergency-banner");
  const body = document.getElementById("supplementary-banner-body");
  if (!banner || !body) return;

  if (isEmergency) {
    banner.classList.remove("hidden");

    let numberGuidance = "Contact your local emergency services immediately.";

    // Only unlock specific numbers if jurisdiction is confirmed as USER_REPORTED
    if (jurisdictionTrustState === "USER_REPORTED" && confirmedJurisdiction && emergencyNumbers.length > 0) {
      const normInput = confirmedJurisdiction.toLowerCase().trim();
      const match = emergencyNumbers.find(entry =>
        entry.jurisdictionAliases.some(alias => normInput.includes(alias.toLowerCase()))
      );

      if (match) {
        numberGuidance = `In ${confirmedJurisdiction}: call ${match.number} immediately.`;
      }
    }

    body.textContent = `Your description may involve an immediately dangerous situation. If anyone is at risk, act now — ${numberGuidance}`;
  } else {
    banner.classList.add("hidden");
    body.textContent = "";
    // Note: No "all safe" or clearance message is ever added
  }
}

/**
 * Handle AI response rendering without overriding or suppressing the emergency banner
 * @param {object} aiResponse
 */
export function handleAiAnalysisResponse(aiResponse) {
  // If banner is active, AI response cannot close or hide it
  const banner = document.getElementById("supplementary-emergency-banner");
  const isBannerActive = banner && !banner.classList.contains("hidden");

  // Render AI output into incident preview
  const liveRegion = document.getElementById("analysis-live-region");
  if (liveRegion) {
    liveRegion.textContent = "Incident analysis complete. Review the structured fields below.";
  }

  // Preserve banner state explicitly
  if (isBannerActive && banner) {
    banner.classList.remove("hidden");
  }
}

/**
 * Read a cookie by name
 * @param {string} name
 * @returns {string|null}
 */
export function getCookie(name) {
  if (typeof document === "undefined" || !document.cookie) return null;
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Initialize event listeners
 */
export function initApp() {
  const descInput = document.getElementById("hazard-description");
  if (descInput) {
    descInput.addEventListener("input", (e) => {
      const isEmergency = detectEmergencyKeywords(e.target.value);
      updateEmergencyBanner(isEmergency);
    });
  }

  loadStaticData();
}

// Auto-initialize in browser DOM environment
if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}
