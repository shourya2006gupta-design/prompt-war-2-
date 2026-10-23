/**
 * SafeRoute Client Application
 * Baseline client module for Emergency Detection, CSRF, and Reporting
 */

// State
let emergencyKeywords = [];
let emergencyNumbers = [];
let userConfirmedJurisdiction = null;

/**
 * Fetch static datasets for client-side synchronous processing
 */
async function loadStaticData() {
  try {
    const [keywordsRes, numbersRes] = await Promise.all([
      fetch("/data/emergency-keywords.json"),
      fetch("/data/emergency-numbers.json")
    ]);
    if (keywordsRes.ok) emergencyKeywords = await keywordsRes.json();
    if (numbersRes.ok) emergencyNumbers = await numbersRes.json();
  } catch (err) {
    console.warn("Could not load static emergency datasets:", err);
    // Safe hardcoded fallback for baseline keyword safety
    emergencyKeywords = ["electrocuted", "electrocution", "live wire", "explosion", "gas leak", "trapped", "unconscious"];
  }
}

/**
 * Synchronous client-side check for emergency keywords.
 * Returns true if an emergency keyword appears in the text.
 * Note: Non-detection never implies that a situation is safe.
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
 * @param {boolean} isEmergency
 */
function updateEmergencyBanner(isEmergency) {
  const banner = document.getElementById("supplementary-emergency-banner");
  const body = document.getElementById("supplementary-banner-body");
  if (!banner || !body) return;

  if (isEmergency) {
    banner.classList.remove("hidden");

    // Check if user has explicitly confirmed jurisdiction and a verified number exists
    let numberText = "Contact your local emergency services immediately.";
    if (userConfirmedJurisdiction && emergencyNumbers.length > 0) {
      const normJurisdiction = userConfirmedJurisdiction.toLowerCase().trim();
      const match = emergencyNumbers.find(entry =>
        entry.jurisdictionAliases.some(alias => normJurisdiction.includes(alias))
      );
      if (match) {
        numberText = `In ${userConfirmedJurisdiction}: call ${match.number} immediately.`;
      }
    }

    body.textContent = `Your description may involve an immediately dangerous situation. If anyone is at risk, act now — ${numberText}`;
  } else {
    banner.classList.add("hidden");
  }
}

/**
 * Read a cookie by name
 * @param {string} name
 * @returns {string|null}
 */
export function getCookie(name) {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Initialize event listeners
 */
function init() {
  const descInput = document.getElementById("hazard-description");
  if (descInput) {
    descInput.addEventListener("input", (e) => {
      const isEmergency = detectEmergencyKeywords(e.target.value);
      updateEmergencyBanner(isEmergency);
    });
  }

  loadStaticData();
}

// Auto-initialize when running in browser
if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}
