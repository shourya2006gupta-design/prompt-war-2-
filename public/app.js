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

let emergencyKeywordsRegex = null;

/**
 * Pre-compile emergency keyword regex for O(text) single-pass evaluation
 */
function rebuildKeywordRegex() {
  if (!emergencyKeywords || emergencyKeywords.length === 0) {
    emergencyKeywordsRegex = null;
    return;
  }
  const escaped = emergencyKeywords
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  emergencyKeywordsRegex = new RegExp(`(?:${escaped})`, "i");
}

rebuildKeywordRegex();

// In-memory authority route cache to eliminate redundant network roundtrips
const authorityCache = new Map();

// Visual evidence uploads state
let uploadedFiles = []; // Array<{ fileId: string, originalName: string, sizeBytes: number, mimeType: string, previewUrl?: string }>

let activeReport = null;
let activeIncidentId = null;
let activeIncidentStatus = "DRAFT";
let activeIncidentCreatedAt = null;
let conversationTurns = [];

const SESSION_STORAGE_KEY = "saferoute_session_incidents";

export const HAZARD_CATEGORIES = [
  { value: "ROAD_DAMAGE", label: "Road Damage / Pothole" },
  { value: "FALLEN_TREE", label: "Fallen Tree / Branch" },
  { value: "FLOODING", label: "Flooding / Standing Water" },
  { value: "UTILITY_LINE_DOWN", label: "Utility / Power Line Down" },
  { value: "DANGEROUS_DEBRIS", label: "Dangerous Road Debris" },
  { value: "STRUCTURAL_DAMAGE", label: "Structural Damage" },
  { value: "FIRE_RISK", label: "Fire Risk / Combustible Material" },
  { value: "WATER_LEAK", label: "Water Main Leak" },
  { value: "SINKHOLES", label: "Sinkhole / Ground Subsidence" },
  { value: "OTHER_INFRASTRUCTURE", label: "Other Infrastructure Problem" },
  { value: "UNKNOWN", label: "Uncertain / Unknown Hazard" },
];

export const URGENCY_LEVELS = [
  { value: "IMMEDIATE", label: "Immediate (High Risk to Life/Safety)" },
  { value: "HIGH", label: "High (Severe Traffic/Safety Impediment)" },
  { value: "MEDIUM", label: "Medium (Significant Defect)" },
  { value: "LOW", label: "Low (Minor Maintenance Needed)" },
  { value: "UNKNOWN", label: "Unknown / To Be Determined" },
];

/**
 * Configure keywords in memory (used by tests and static loader)
 * @param {string[]} keywords
 */
export function setEmergencyKeywords(keywords) {
  if (Array.isArray(keywords)) {
    emergencyKeywords = keywords;
    rebuildKeywordRegex();
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

export function getActiveReport() {
  return activeReport;
}

export function setActiveReport(report) {
  activeReport = report;
}

export function getActiveIncidentId() {
  return activeIncidentId;
}

export function setActiveIncidentId(id) {
  activeIncidentId = id;
}

export function getActiveIncidentStatus() {
  return activeIncidentStatus;
}

export function setActiveIncidentStatus(status) {
  activeIncidentStatus = status;
}

/**
 * Return uploaded visual evidence files
 */
export function getUploadedFiles() {
  return [...uploadedFiles];
}

/**
 * Return uploaded file IDs for AI analyze request
 */
export function getUploadedFileIds() {
  return uploadedFiles.map((f) => f.fileId);
}

/**
 * Format bytes into human-readable string
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (typeof bytes !== "number" || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Remove an uploaded file by fileId and revoke object URL
 * @param {string} fileId
 */
export function removeUploadedFile(fileId) {
  const target = uploadedFiles.find((f) => f.fileId === fileId);
  if (target && target.previewUrl && typeof URL !== "undefined" && URL.revokeObjectURL) {
    try {
      URL.revokeObjectURL(target.previewUrl);
    } catch {
      // Ignore
    }
  }
  uploadedFiles = uploadedFiles.filter((f) => f.fileId !== fileId);
  renderImagePreviews();
}

/**
 * Clear all uploaded files and revoke object URLs
 */
export function clearUploadedFiles() {
  uploadedFiles.forEach((f) => {
    if (f.previewUrl && typeof URL !== "undefined" && URL.revokeObjectURL) {
      try {
        URL.revokeObjectURL(f.previewUrl);
      } catch {
        // Ignore
      }
    }
  });
  uploadedFiles = [];
  renderImagePreviews();
}

/**
 * Render uploaded visual evidence previews using DocumentFragment
 */
export function renderImagePreviews() {
  const container = document.getElementById("upload-preview-container");
  if (!container) return;

  container.textContent = "";

  if (uploadedFiles.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  const fragment = document.createDocumentFragment();

  uploadedFiles.forEach((file) => {
    const card = document.createElement("div");
    card.className = "upload-preview-card";
    card.dataset.fileId = file.fileId;

    if (file.previewUrl) {
      const img = document.createElement("img");
      img.className = "upload-preview-thumb";
      img.src = file.previewUrl;
      img.alt = `Sanitized preview: ${file.originalName}`;
      card.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "upload-preview-icon";
      icon.textContent = "📷";
      card.appendChild(icon);
    }

    const details = document.createElement("div");
    details.className = "upload-preview-details";

    const nameSpan = document.createElement("span");
    nameSpan.className = "upload-preview-name";
    nameSpan.textContent = file.originalName;

    const sizeSpan = document.createElement("span");
    sizeSpan.className = "upload-preview-size";
    sizeSpan.textContent = `${formatFileSize(file.sizeBytes)} • Metadata Stripped`;

    details.appendChild(nameSpan);
    details.appendChild(sizeSpan);
    card.appendChild(details);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "upload-preview-remove";
    removeBtn.setAttribute("aria-label", `Remove image ${file.originalName}`);
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      removeUploadedFile(file.fileId);
    });

    card.appendChild(removeBtn);
    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}

/**
 * Validate and upload visual evidence files to /api/upload
 * @param {FileList|File[]} fileList
 */
export async function handleFileUpload(fileList) {
  if (!fileList || fileList.length === 0) return;

  const errorEl = document.getElementById("upload-error");
  if (errorEl) {
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }

  const filesToUpload = Array.from(fileList);

  if (uploadedFiles.length + filesToUpload.length > 5) {
    if (errorEl) {
      errorEl.textContent = `Upload limit reached: Maximum of 5 images allowed per session (${uploadedFiles.length} currently attached).`;
      errorEl.classList.remove("hidden");
    }
    return;
  }

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

  const csrfToken = getCookie("csrf_token");

  for (const file of filesToUpload) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      if (errorEl) {
        errorEl.textContent = `Invalid file format for "${file.name}". Allowed formats: JPEG, PNG, WebP.`;
        errorEl.classList.remove("hidden");
      }
      continue;
    }

    if (file.size > MAX_SIZE) {
      if (errorEl) {
        errorEl.textContent = `File "${file.name}" exceeds the maximum allowed size of 5 MB.`;
        errorEl.classList.remove("hidden");
      }
      continue;
    }

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Upload failed (HTTP ${res.status})`);
      }

      const uploadResult = await res.json();
      const previewUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null;

      uploadedFiles.push({
        fileId: uploadResult.fileId,
        originalName: uploadResult.originalName || file.name,
        sizeBytes: uploadResult.sizeBytes || file.size,
        mimeType: uploadResult.mimeType || file.type,
        previewUrl,
      });

      renderImagePreviews();
    } catch (err) {
      console.error("[SafeRoute Upload Error]", err);
      if (errorEl) {
        errorEl.textContent = `Failed to upload "${file.name}": ${err.message}`;
        errorEl.classList.remove("hidden");
      }
    }
  }
}

/**
 * Generate unique incident ID
 */
export function generateIncidentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "inc-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
}

/**
 * Load incidents array from sessionStorage
 * @returns {Array}
 */
export function loadSessionIncidents() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const data = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch (err) {
    console.warn("[SafeRoute] Could not access sessionStorage:", err.message);
  }
  return [];
}

/**
 * Save incidents array to sessionStorage
 * @param {Array} incidents
 */
export function saveSessionIncidents(incidents) {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(incidents));
    }
  } catch (err) {
    console.warn("[SafeRoute] Failed to write to sessionStorage:", err.message);
  }
}

/**
 * Save or update the active incident in sessionStorage
 * @param {string|null} statusOverride
 */
export function saveCurrentIncident(statusOverride = null) {
  if (!activeReport) return null;
  if (!activeIncidentId) {
    activeIncidentId = generateIncidentId();
    activeIncidentCreatedAt = new Date().toISOString();
  }
  if (statusOverride) {
    activeIncidentStatus = statusOverride;
  }

  const now = new Date().toISOString();
  const incidents = loadSessionIncidents();
  const existingIdx = incidents.findIndex(item => item.id === activeIncidentId);

  const incidentRecord = {
    id: activeIncidentId,
    createdAt: activeIncidentCreatedAt || now,
    updatedAt: now,
    status: activeIncidentStatus || "DRAFT",
    report: activeReport,
  };

  if (existingIdx >= 0) {
    incidents[existingIdx] = incidentRecord;
  } else {
    incidents.unshift(incidentRecord);
  }

  saveSessionIncidents(incidents);
  renderSessionDashboard();
  return incidentRecord;
}

/**
 * Remove an incident from sessionStorage by ID
 * @param {string} id
 */
export function removeIncidentFromSession(id) {
  const incidents = loadSessionIncidents().filter(item => item.id !== id);
  saveSessionIncidents(incidents);
  if (activeIncidentId === id) {
    resetReport();
  }
  renderSessionDashboard();
}

/**
 * Clear all incidents from sessionStorage
 */
export function clearAllSessionIncidents() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch (err) {
    console.warn("[SafeRoute] Could not clear sessionStorage:", err.message);
  }
  resetReport();
  renderSessionDashboard();
}

/**
 * Export an incident as a clean, trust-annotated JSON file
 * @param {object} incidentRecord
 */
export function exportIncidentAsJson(incidentRecord) {
  if (!incidentRecord || !incidentRecord.report) return;

  const exportPayload = {
    safeRouteSchemaVersion: "1.0.0",
    incidentId: incidentRecord.id,
    status: incidentRecord.status,
    createdAt: incidentRecord.createdAt,
    updatedAt: incidentRecord.updatedAt,
    exportedAt: new Date().toISOString(),
    report: incidentRecord.report,
    ...(incidentRecord.authorityHandoff ? { authorityHandoff: incidentRecord.authorityHandoff } : {}),
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);

  if (typeof Blob !== "undefined" && typeof document !== "undefined") {
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `saferoute-incident-${incidentRecord.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/**
 * Load an incident from the dashboard back into the active review card
 * @param {object} incidentRecord
 */
export function loadIncidentForReview(incidentRecord) {
  if (!incidentRecord || !incidentRecord.report) return;
  activeIncidentId = incidentRecord.id;
  activeIncidentStatus = incidentRecord.status;
  activeIncidentCreatedAt = incidentRecord.createdAt;
  activeReport = incidentRecord.report;

  // Restore confirmed jurisdiction if report had user-reported jurisdiction
  const jurisVal = incidentRecord.report.inferredJurisdiction?.value || null;
  const jurisTrust = incidentRecord.report.inferredJurisdiction?.trustState || null;
  if (jurisTrust === "USER_REPORTED") {
    setJurisdiction(jurisVal, "USER_REPORTED");
  } else {
    setJurisdiction(jurisVal, "AI_INFERRED");
  }

  handleAiAnalysisResponse(incidentRecord.report, false); // false = preserve activeIncidentId

  const resultsSection = document.getElementById("incident-results-section");
  if (resultsSection) {
    resultsSection.classList.remove("hidden");
    if (typeof resultsSection.scrollIntoView === "function") {
      resultsSection.scrollIntoView({ behavior: "smooth" });
    }
  }
}

/**
 * Human-readable label for incident status
 * @param {string} status
 */
export function formatStatusLabel(status) {
  switch (status) {
    case "READY_FOR_ROUTING":
      return "Ready for Routing";
    case "LINK_PROVIDED":
      return "Link Provided";
    case "USER_CONFIRMED_SUBMISSION":
      return "Submission Confirmed";
    default:
      return "Draft";
  }
}

/**
 * Render session incidents list strictly using textContent
 */
export function renderSessionDashboard() {
  const container = document.getElementById("session-incidents-list");
  const clearBtn = document.getElementById("clear-session-btn");
  if (!container) return;

  container.textContent = "";

  const incidents = loadSessionIncidents();
  if (incidents.length === 0) {
    const emptyP = document.createElement("p");
    emptyP.className = "empty-state";
    emptyP.textContent = "No incidents drafted in this session yet.";
    container.appendChild(emptyP);

    if (clearBtn) clearBtn.classList.add("hidden");
    return;
  }

  if (clearBtn) clearBtn.classList.remove("hidden");

  const fragment = document.createDocumentFragment();

  incidents.forEach(inc => {
    const card = document.createElement("article");
    card.className = "incident-item-card";
    card.setAttribute("aria-labelledby", `inc-title-${inc.id}`);

    // Header row
    const header = document.createElement("div");
    header.className = "inc-card-header";

    const title = document.createElement("h3");
    title.id = `inc-title-${inc.id}`;
    title.className = "inc-card-title";

    const categoryObj = HAZARD_CATEGORIES.find(c => c.value === inc.report?.hazardCategory?.value);
    title.textContent = categoryObj ? categoryObj.label : (inc.report?.hazardCategory?.value || "Hazard Incident");

    const statusBadge = document.createElement("span");
    const statusClass = (inc.status || "DRAFT").toLowerCase();
    statusBadge.className = `status-badge status-badge--${statusClass}`;
    statusBadge.textContent = formatStatusLabel(inc.status || "DRAFT");

    header.appendChild(title);
    header.appendChild(statusBadge);
    card.appendChild(header);

    // Description snippet
    const descP = document.createElement("p");
    descP.className = "inc-card-desc";
    const descText = inc.report?.description?.value || inc.report?.incidentSummary || "No description provided.";
    descP.textContent = descText.length > 180 ? `${descText.slice(0, 180)}...` : descText;
    card.appendChild(descP);

    // Meta row
    const meta = document.createElement("div");
    meta.className = "inc-card-meta";

    const urgSpan = document.createElement("span");
    urgSpan.className = "inc-meta-item";
    const urgStrong = document.createElement("strong");
    urgStrong.textContent = "Urgency: ";
    urgSpan.appendChild(urgStrong);
    urgSpan.appendChild(document.createTextNode(inc.report?.urgencyLevel?.value || "UNKNOWN"));
    meta.appendChild(urgSpan);

    const jurisSpan = document.createElement("span");
    jurisSpan.className = "inc-meta-item";
    const jurisStrong = document.createElement("strong");
    jurisStrong.textContent = "Jurisdiction: ";
    jurisSpan.appendChild(jurisStrong);
    const jurisVal = inc.report?.inferredJurisdiction?.value || "Unspecified";
    const jurisTrust = inc.report?.inferredJurisdiction?.trustState === "USER_REPORTED" ? " (Confirmed)" : " (Inferred)";
    jurisSpan.appendChild(document.createTextNode(`${jurisVal}${jurisTrust}`));
    meta.appendChild(jurisSpan);

    const timeSpan = document.createElement("span");
    timeSpan.className = "inc-meta-item";
    const timeStrong = document.createElement("strong");
    timeStrong.textContent = "Updated: ";
    timeSpan.appendChild(timeStrong);
    const updatedDate = new Date(inc.updatedAt || inc.createdAt);
    timeSpan.appendChild(document.createTextNode(isNaN(updatedDate.getTime()) ? "Recently" : updatedDate.toLocaleTimeString()));
    meta.appendChild(timeSpan);

    card.appendChild(meta);

    // Actions row
    const actions = document.createElement("div");
    actions.className = "inc-card-actions";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn btn-outline btn-sm btn-view-inc";
    viewBtn.textContent = "View / Edit";
    viewBtn.addEventListener("click", () => loadIncidentForReview(inc));

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className = "btn btn-outline btn-sm btn-export-inc";
    exportBtn.textContent = "Download JSON";
    exportBtn.addEventListener("click", () => exportIncidentAsJson(inc));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-outline btn-sm btn-delete-inc";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeIncidentFromSession(inc.id));

    actions.appendChild(viewBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}

/**
 * Fetch static datasets for client-side synchronous processing
 */
export async function loadStaticData() {
  if (typeof fetch === "undefined") return;
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
  if (!emergencyKeywordsRegex) {
    rebuildKeywordRegex();
  }
  return emergencyKeywordsRegex ? emergencyKeywordsRegex.test(text) : false;
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
export function handleAiAnalysisResponse(aiResponse, createNewId = true) {
  const banner = document.getElementById("supplementary-emergency-banner");
  const isBannerActive = banner && !banner.classList.contains("hidden");

  activeReport = aiResponse;

  if (createNewId || !activeIncidentId) {
    activeIncidentId = generateIncidentId();
    activeIncidentStatus = "DRAFT";
    activeIncidentCreatedAt = new Date().toISOString();
  }

  renderIncidentReview(aiResponse);
  saveCurrentIncident();

  const resultsSection = document.getElementById("incident-results-section");
  if (resultsSection) {
    resultsSection.classList.remove("hidden");
  }

  const liveRegion = document.getElementById("analysis-live-region");
  if (liveRegion) {
    liveRegion.textContent = "Incident analysis complete. Please review the structured fields below.";
  }

  const resultsTitle = document.getElementById("results-title");
  if (resultsTitle && typeof resultsTitle.focus === "function") {
    resultsTitle.focus();
  }

  // Preserve banner state explicitly
  if (isBannerActive && banner) {
    banner.classList.remove("hidden");
  }
}

/**
 * Helper to create a trust badge element
 * @param {"AI_INFERRED"|"USER_VERIFIED"|"USER_REPORTED"} trustState
 */
export function createTrustBadge(trustState) {
  const badge = document.createElement("span");
  if (trustState === "AI_INFERRED") {
    badge.className = "trust-badge trust-badge--ai";
    badge.textContent = "AI Inferred";
  } else if (trustState === "EVIDENCE_SUPPORTED") {
    badge.className = "trust-badge trust-badge--evidence";
    badge.textContent = "Evidence Supported";
  } else if (trustState === "USER_REPORTED") {
    badge.className = "trust-badge trust-badge--user";
    badge.textContent = "User Reported";
  } else {
    badge.className = "trust-badge trust-badge--user";
    badge.textContent = "User Verified";
  }
  return badge;
}

/**
 * Render structured review form strictly using textContent (No innerHTML for values)
 * @param {object} report
 */
export function renderIncidentReview(report) {
  const container = document.getElementById("incident-card");
  if (!container) return;

  // Clear previous contents safely
  container.textContent = "";

  // 1. Incident Summary Callout
  const summaryBox = document.createElement("div");
  summaryBox.className = "incident-summary-callout";

  const summaryHeading = document.createElement("div");
  summaryHeading.className = "summary-heading";
  summaryHeading.textContent = `Incident Summary (${(report.detectedLanguage || "en").toUpperCase()})`;

  const summaryText = document.createElement("p");
  summaryText.className = "summary-text";
  summaryText.textContent = report.incidentSummary || "No summary provided.";

  summaryBox.appendChild(summaryHeading);
  summaryBox.appendChild(summaryText);
  container.appendChild(summaryBox);

  // 2. Incident Field Grid
  const grid = document.createElement("div");
  grid.className = "incident-grid";

  // Field: Hazard Category
  const categoryField = document.createElement("div");
  categoryField.className = "incident-field";

  const categoryHeader = document.createElement("div");
  categoryHeader.className = "field-header";

  const categoryLabel = document.createElement("label");
  categoryLabel.className = "field-label";
  categoryLabel.htmlFor = "review-category-select";
  categoryLabel.textContent = "Hazard Category";

  const categoryBadge = createTrustBadge(report.hazardCategory?.trustState || "AI_INFERRED");
  categoryBadge.id = "badge-category";

  categoryHeader.appendChild(categoryLabel);
  categoryHeader.appendChild(categoryBadge);

  const categorySelect = document.createElement("select");
  categorySelect.id = "review-category-select";
  categorySelect.className = "form-control";

  const currentCategoryVal = report.hazardCategory?.value || "UNKNOWN";
  HAZARD_CATEGORIES.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.value;
    opt.textContent = cat.label;
    if (cat.value === currentCategoryVal) {
      opt.selected = true;
    }
    categorySelect.appendChild(opt);
  });

  categorySelect.addEventListener("change", (e) => {
    if (activeReport && activeReport.hazardCategory) {
      activeReport.hazardCategory.value = e.target.value;
      activeReport.hazardCategory.trustState = "USER_VERIFIED";
      activeReport.hazardCategory.source = "Citizen Verified";
      saveCurrentIncident();
    }
    categoryBadge.className = "trust-badge trust-badge--user";
    categoryBadge.textContent = "User Verified";
  });

  categoryField.appendChild(categoryHeader);
  categoryField.appendChild(categorySelect);
  grid.appendChild(categoryField);

  // Field: Urgency Level
  const urgencyField = document.createElement("div");
  urgencyField.className = "incident-field";

  const urgencyHeader = document.createElement("div");
  urgencyHeader.className = "field-header";

  const urgencyLabel = document.createElement("label");
  urgencyLabel.className = "field-label";
  urgencyLabel.htmlFor = "review-urgency-select";
  urgencyLabel.textContent = "Urgency Assessment";

  const urgencyBadge = createTrustBadge(report.urgencyLevel?.trustState || "AI_INFERRED");
  urgencyBadge.id = "badge-urgency";

  urgencyHeader.appendChild(urgencyLabel);
  urgencyHeader.appendChild(urgencyBadge);

  const urgencySelect = document.createElement("select");
  urgencySelect.id = "review-urgency-select";
  urgencySelect.className = "form-control";

  const currentUrgencyVal = report.urgencyLevel?.value || "UNKNOWN";
  URGENCY_LEVELS.forEach(urg => {
    const opt = document.createElement("option");
    opt.value = urg.value;
    opt.textContent = urg.label;
    if (urg.value === currentUrgencyVal) {
      opt.selected = true;
    }
    urgencySelect.appendChild(opt);
  });

  urgencySelect.addEventListener("change", (e) => {
    if (activeReport && activeReport.urgencyLevel) {
      activeReport.urgencyLevel.value = e.target.value;
      activeReport.urgencyLevel.trustState = "USER_VERIFIED";
      activeReport.urgencyLevel.source = "Citizen Verified";
      saveCurrentIncident();
    }
    urgencyBadge.className = "trust-badge trust-badge--user";
    urgencyBadge.textContent = "User Verified";
  });

  urgencyField.appendChild(urgencyHeader);
  urgencyField.appendChild(urgencySelect);
  grid.appendChild(urgencyField);

  // Field: Refined Description
  const descField = document.createElement("div");
  descField.className = "incident-field incident-field--full";

  const descHeader = document.createElement("div");
  descHeader.className = "field-header";

  const descLabel = document.createElement("label");
  descLabel.className = "field-label";
  descLabel.htmlFor = "review-description-input";
  descLabel.textContent = "Factual Description";

  const descBadge = createTrustBadge(report.description?.trustState || "AI_INFERRED");
  descBadge.id = "badge-description";

  descHeader.appendChild(descLabel);
  descHeader.appendChild(descBadge);

  const descInput = document.createElement("textarea");
  descInput.id = "review-description-input";
  descInput.className = "form-control";
  descInput.rows = 3;
  descInput.value = report.description?.value || "";

  descInput.addEventListener("input", (e) => {
    if (activeReport && activeReport.description) {
      activeReport.description.value = e.target.value;
      activeReport.description.trustState = "USER_VERIFIED";
      saveCurrentIncident();
    }
    descBadge.className = "trust-badge trust-badge--user";
    descBadge.textContent = "User Verified";
  });

  descField.appendChild(descHeader);
  descField.appendChild(descInput);
  grid.appendChild(descField);

  // Field: Location Details
  const locField = document.createElement("div");
  locField.className = "incident-field incident-field--full";

  const locHeader = document.createElement("div");
  locHeader.className = "field-header";

  const locLabel = document.createElement("label");
  locLabel.className = "field-label";
  locLabel.htmlFor = "review-location-input";
  locLabel.textContent = "Reported Location";

  const locBadge = createTrustBadge(report.locationText?.trustState || "AI_INFERRED");
  locBadge.id = "badge-location";

  locHeader.appendChild(locLabel);
  locHeader.appendChild(locBadge);

  const locInput = document.createElement("input");
  locInput.type = "text";
  locInput.id = "review-location-input";
  locInput.className = "form-control";
  locInput.value = report.locationText?.value || "";

  locInput.addEventListener("input", (e) => {
    if (activeReport && activeReport.locationText) {
      activeReport.locationText.value = e.target.value;
      activeReport.locationText.trustState = "USER_VERIFIED";
      saveCurrentIncident();
    }
    locBadge.className = "trust-badge trust-badge--user";
    locBadge.textContent = "User Verified";
  });

  locField.appendChild(locHeader);
  locField.appendChild(locInput);
  grid.appendChild(locField);

  container.appendChild(grid);

  // 3. Render Jurisdiction Confirmation Section
  renderJurisdictionSection(report);

  // 4. Render Clarification Questions
  renderClarificationsSection(report);
}

/**
 * Render jurisdiction confirmation section with explicit user gating
 * @param {object} report
 */
export function renderJurisdictionSection(report) {
  const box = document.getElementById("jurisdiction-confirmation-box");
  if (!box) return;

  box.textContent = "";

  const inferredVal = report.inferredJurisdiction?.value || null;

  // Track initial inferred state
  setJurisdiction(inferredVal, "AI_INFERRED");

  // Status row displaying inferred value
  const statusRow = document.createElement("div");
  statusRow.className = "jurisdiction-status-row";

  const labelSpan = document.createElement("span");
  labelSpan.textContent = inferredVal
    ? `AI Inferred Jurisdiction: ${inferredVal}`
    : "AI Inferred Jurisdiction: None identified";

  const jurisBadge = createTrustBadge("AI_INFERRED");
  jurisBadge.id = "badge-jurisdiction";

  statusRow.appendChild(labelSpan);
  statusRow.appendChild(jurisBadge);
  box.appendChild(statusRow);

  // Controls for explicit confirmation
  const controls = document.createElement("div");
  controls.className = "jurisdiction-controls";

  const selectLabel = document.createElement("label");
  selectLabel.htmlFor = "jurisdiction-select";
  selectLabel.className = "form-label";
  selectLabel.textContent = "Confirm or Select Local Jurisdiction:";

  const select = document.createElement("select");
  select.id = "jurisdiction-select";
  select.className = "form-control";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "-- Select your jurisdiction --";
  select.appendChild(defaultOpt);

  if (inferredVal) {
    const inferredOpt = document.createElement("option");
    inferredOpt.value = inferredVal;
    inferredOpt.textContent = `Confirm inferred: ${inferredVal}`;
    select.appendChild(inferredOpt);
  }

  const ukOpt = document.createElement("option");
  ukOpt.value = "England, United Kingdom";
  ukOpt.textContent = "England, United Kingdom";
  select.appendChild(ukOpt);

  const ausOpt = document.createElement("option");
  ausOpt.value = "Australia";
  ausOpt.textContent = "Australia";
  select.appendChild(ausOpt);

  const usOpt = document.createElement("option");
  usOpt.value = "United States";
  usOpt.textContent = "United States";
  select.appendChild(usOpt);

  const customOpt = document.createElement("option");
  customOpt.value = "CUSTOM";
  customOpt.textContent = "Other / Custom Region";
  select.appendChild(customOpt);

  const customInput = document.createElement("input");
  customInput.type = "text";
  customInput.id = "jurisdiction-custom-input";
  customInput.className = "form-control hidden";
  customInput.placeholder = "Enter municipality, county, or state";
  customInput.setAttribute("aria-label", "Specify custom or other jurisdiction");

  select.addEventListener("change", (e) => {
    if (e.target.value === "CUSTOM") {
      customInput.classList.remove("hidden");
      customInput.focus();
    } else {
      customInput.classList.add("hidden");
    }
  });

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.id = "confirm-jurisdiction-btn";
  confirmBtn.className = "btn btn-secondary";
  confirmBtn.textContent = "Confirm Jurisdiction";

  const statusMsg = document.createElement("div");
  statusMsg.id = "jurisdiction-status-msg";
  statusMsg.className = "form-help";

  confirmBtn.addEventListener("click", () => {
    let chosen = select.value === "CUSTOM" ? customInput.value.trim() : select.value.trim();

    if (!chosen) {
      statusMsg.textContent = "Please select or enter a jurisdiction to confirm.";
      statusMsg.style.color = "var(--emergency-accent)";
      return;
    }

    // Set state explicitly to USER_REPORTED
    setJurisdiction(chosen, "USER_REPORTED");

    if (activeReport && activeReport.inferredJurisdiction) {
      activeReport.inferredJurisdiction.value = chosen;
      activeReport.inferredJurisdiction.trustState = "USER_REPORTED";
    }

    activeIncidentStatus = "READY_FOR_ROUTING";
    saveCurrentIncident("READY_FOR_ROUTING");

    jurisBadge.className = "trust-badge trust-badge--user";
    jurisBadge.textContent = "User Confirmed";

    statusMsg.textContent = `Jurisdiction confirmed: ${chosen}. Local authority routing unlocked.`;
    statusMsg.style.color = "var(--badge-user-text)";

    // Unlock routing button
    const findAuthBtn = document.getElementById("find-authority-btn");
    const routingHint = document.getElementById("routing-hint");
    if (findAuthBtn) {
      findAuthBtn.disabled = false;
    }
    if (routingHint) {
      routingHint.textContent = `Ready to route for confirmed jurisdiction: ${chosen}.`;
    }

    // Re-evaluate emergency keywords on current description:
    // If an emergency was identified, this dynamically reveals the local verified emergency number
    const reviewDesc = document.getElementById("review-description-input")?.value || "";
    const intakeDesc = document.getElementById("hazard-description")?.value || "";
    if (detectEmergencyKeywords(reviewDesc) || detectEmergencyKeywords(intakeDesc)) {
      updateEmergencyBanner(true);
    }
  });

  controls.appendChild(selectLabel);
  controls.appendChild(select);
  controls.appendChild(customInput);
  controls.appendChild(confirmBtn);
  controls.appendChild(statusMsg);
  box.appendChild(controls);
}

/**
 * Render clarification questions section
 * @param {object} report
 */
export function renderClarificationsSection(report) {
  const container = document.getElementById("clarifications-container");
  const list = document.getElementById("clarifications-list");
  if (!container || !list) return;

  list.textContent = "";

  const questions = report.clarificationQuestions || [];
  if (questions.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");

  questions.forEach(q => {
    const item = document.createElement("div");
    item.className = "clarification-item";

    const label = document.createElement("label");
    label.className = "clarification-label";
    label.htmlFor = `clarification-input-${q.id}`;
    label.textContent = q.question;

    const input = document.createElement("input");
    input.type = "text";
    input.id = `clarification-input-${q.id}`;
    input.className = "form-control";
    input.dataset.questionId = q.id;
    input.dataset.targetField = q.field;
    input.placeholder = "Enter clarification details...";

    item.appendChild(label);
    item.appendChild(input);
    list.appendChild(item);
  });
}

/**
 * Read a cookie by name
 * @param {string} name
 * @returns {string|null}
 */
export function getCookie(name) {
  if (typeof document === "undefined" || !document.cookie) return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp("(^| )" + escapedName + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Handle initial hazard report form submission
 * @param {Event} e
 */
export async function handleReportSubmit(e) {
  e.preventDefault();

  const form = document.getElementById("hazard-report-form");
  const descInput = document.getElementById("hazard-description");
  const locInput = document.getElementById("hazard-location");
  const generalError = document.getElementById("form-general-error");
  const descError = document.getElementById("description-error");
  const submitBtn = document.getElementById("submit-report-btn");
  const liveRegion = document.getElementById("analysis-live-region");

  if (!descInput) return;

  // Clear previous errors
  if (generalError) {
    generalError.classList.add("hidden");
    generalError.textContent = "";
  }
  if (descError) {
    descError.classList.add("hidden");
    descError.textContent = "";
  }
  descInput.removeAttribute("aria-invalid");

  const message = descInput.value.trim();
  const locationText = locInput ? locInput.value.trim() : "";

  if (!message) {
    descInput.setAttribute("aria-invalid", "true");
    if (descError) {
      descError.textContent = "Please provide a description of the hazard.";
      descError.classList.remove("hidden");
    }
    descInput.focus();
    return;
  }

  // Set loading state
  if (form) form.setAttribute("aria-busy", "true");
  if (submitBtn) {
    submitBtn.disabled = true;
    const btnText = submitBtn.querySelector(".btn-text");
    const btnSpinner = submitBtn.querySelector(".btn-spinner");
    if (btnText) btnText.textContent = "Analyzing with Gemini AI...";
    if (btnSpinner) btnSpinner.classList.remove("hidden");
  }
  if (liveRegion) {
    liveRegion.textContent = "Analyzing hazard observation with Gemini AI. Please wait...";
  }

  try {
    const csrfToken = getCookie("csrf_token");

    const fileIds = getUploadedFileIds();
    const payload = {
      message,
      ...(locationText ? { locationText } : {}),
      ...(conversationTurns.length > 0 ? { priorTurns: conversationTurns } : {}),
      ...(fileIds.length > 0 ? { fileIds } : {}),
    };

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errorMessage = errData.error || `Analysis request failed (HTTP ${res.status}).`;
      throw new Error(errorMessage);
    }

    const report = await res.json();

    // Record turn in conversation turns
    conversationTurns.push({ role: "user", text: message });
    conversationTurns.push({ role: "model", text: report.incidentSummary || "Report analyzed." });
    if (conversationTurns.length > 4) {
      conversationTurns = conversationTurns.slice(-4);
    }

    handleAiAnalysisResponse(report);
  } catch (err) {
    console.error("[SafeRoute Submit Error]", err);
    if (generalError) {
      generalError.textContent = err.message || "An error occurred during analysis. Please try again.";
      generalError.classList.remove("hidden");
    }
    if (liveRegion) {
      liveRegion.textContent = `Error: ${err.message}`;
    }
  } finally {
    if (form) form.setAttribute("aria-busy", "false");
    if (submitBtn) {
      submitBtn.disabled = false;
      const btnText = submitBtn.querySelector(".btn-text");
      const btnSpinner = submitBtn.querySelector(".btn-spinner");
      if (btnText) btnText.textContent = "Analyze & Structure Report";
      if (btnSpinner) btnSpinner.classList.add("hidden");
    }
  }
}

/**
 * Handle clarification re-submission
 */
export async function handleClarificationsSubmit() {
  const inputs = document.querySelectorAll("#clarifications-list input");
  const clarifications = [];

  inputs.forEach(input => {
    if (input.value && input.value.trim() !== "") {
      clarifications.push(`${input.dataset.targetField || "Detail"}: ${input.value.trim()}`);
    }
  });

  if (clarifications.length === 0) return;

  const descInput = document.getElementById("hazard-description");
  const locInput = document.getElementById("hazard-location");
  const originalMessage = descInput?.value || activeReport?.description?.value || "";
  const clarifiedMessage = `${originalMessage}\nAdditional Details:\n${clarifications.join("\n")}`;

  if (descInput) {
    descInput.value = clarifiedMessage;
  }

  // Trigger re-analysis
  const fakeEvent = { preventDefault: () => {} };
  await handleReportSubmit(fakeEvent);
}

/**
 * Reset application state for a new report
 */
export function resetReport() {
  activeReport = null;
  activeIncidentId = null;
  activeIncidentStatus = "DRAFT";
  activeIncidentCreatedAt = null;
  conversationTurns = [];
  setJurisdiction(null, null);
  clearUploadedFiles();

  const fileInput = document.getElementById("hazard-image");
  if (fileInput) fileInput.value = "";

  const uploadError = document.getElementById("upload-error");
  if (uploadError) {
    uploadError.classList.add("hidden");
    uploadError.textContent = "";
  }

  const form = document.getElementById("hazard-report-form");
  if (form) form.reset();

  const resultsSection = document.getElementById("incident-results-section");
  if (resultsSection) resultsSection.classList.add("hidden");

  const counter = document.getElementById("char-counter");
  if (counter) counter.textContent = "0 / 2,000 characters";

  const banner = document.getElementById("supplementary-emergency-banner");
  if (banner) banner.classList.add("hidden");

  const descInput = document.getElementById("hazard-description");
  if (descInput && typeof descInput.focus === "function") {
    descInput.focus();
  }

  renderSessionDashboard();
}

/**
 * Handle authority routing lookup
 */
export async function handleFindAuthority() {
  const findAuthBtn = document.getElementById("find-authority-btn");
  const routingHint = document.getElementById("routing-hint");
  const liveRegion = document.getElementById("analysis-live-region");
  const resultsBox = document.getElementById("authority-results-box");

  const jurisdictionState = getJurisdictionState();
  if (jurisdictionState.jurisdictionTrustState !== "USER_REPORTED" || !jurisdictionState.confirmedJurisdiction) {
    if (routingHint) {
      routingHint.textContent = "Please confirm your jurisdiction above before routing.";
      routingHint.style.color = "var(--emergency-accent)";
    }
    return;
  }

  if (findAuthBtn) {
    findAuthBtn.disabled = true;
    findAuthBtn.textContent = "Routing to verified authority...";
  }
  if (liveRegion) {
    liveRegion.textContent = "Querying verified civic authority registers for confirmed jurisdiction...";
  }

  try {
    const csrfToken = getCookie("csrf_token");
    const hazardCategory = activeReport?.hazardCategory?.value || "UNKNOWN";
    const confirmedJurisdiction = jurisdictionState.confirmedJurisdiction;
    const cacheKey = `${hazardCategory}:${confirmedJurisdiction.toLowerCase().trim()}`;

    let routeResult;
    if (authorityCache.has(cacheKey)) {
      routeResult = authorityCache.get(cacheKey);
    } else {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify({
          hazardCategory,
          confirmedJurisdiction,
          userExplicitlyConfirmed: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Routing lookup failed (HTTP ${res.status}).`);
      }

      routeResult = await res.json();
      authorityCache.set(cacheKey, routeResult);
    }

    renderAuthorityRoutingResult(routeResult);

    if (routeResult.authorities && routeResult.authorities.length > 0) {
      const topAuth = routeResult.authorities[0];
      if (activeReport) {
        activeReport.authorityHandoff = {
          authorityId: topAuth.id,
          authorityName: topAuth.name,
          reportingUrl: topAuth.reportingUrl,
          providedAt: new Date().toISOString(),
        };
      }
      activeIncidentStatus = "LINK_PROVIDED";
      saveCurrentIncident("LINK_PROVIDED");

      if (liveRegion) {
        liveRegion.textContent = `Verified authority found: ${topAuth.name}. Direct reporting link provided.`;
      }
    } else {
      if (liveRegion) {
        liveRegion.textContent = "No verified digital reporting channel matches your jurisdiction and hazard type.";
      }
    }
  } catch (err) {
    console.error("[SafeRoute Route Error]", err);
    if (resultsBox) {
      resultsBox.textContent = "";
      resultsBox.classList.remove("hidden");
      const errP = document.createElement("p");
      errP.className = "form-error";
      errP.textContent = err.message || "Failed to find authorities.";
      resultsBox.appendChild(errP);
    }
    if (liveRegion) {
      liveRegion.textContent = `Routing error: ${err.message}`;
    }
  } finally {
    if (findAuthBtn) {
      findAuthBtn.disabled = false;
      findAuthBtn.textContent = "Find Reporting Authority";
    }
  }
}

/**
 * Render authority routing result strictly via textContent
 * @param {object} routeResult
 */
export function renderAuthorityRoutingResult(routeResult) {
  const box = document.getElementById("authority-results-box");
  if (!box) return;

  box.textContent = "";
  box.classList.remove("hidden");

  const authorities = routeResult.authorities || [];
  const jurisdictionState = getJurisdictionState();

  if (authorities.length === 0) {
    const noMatchCard = document.createElement("div");
    noMatchCard.className = "no-match-card";

    const title = document.createElement("h4");
    title.className = "no-match-title";
    title.textContent = "No Verified Online Reporting Channel Identified";

    const desc = document.createElement("p");
    desc.className = "no-match-text";
    desc.textContent = `SafeRoute has not verified a digital hazard intake portal for this hazard in ${jurisdictionState.confirmedJurisdiction || "your selected region"}.`;

    const note = document.createElement("p");
    note.className = "no-match-guidance";
    note.textContent = "SafeRoute never fabricates unverified government URLs. Please contact your local municipal council or highways department directly. For life-threatening emergencies, call your local emergency number immediately.";

    noMatchCard.appendChild(title);
    noMatchCard.appendChild(desc);
    noMatchCard.appendChild(note);
    box.appendChild(noMatchCard);
    return;
  }

  const fragment = document.createDocumentFragment();

  authorities.forEach(auth => {
    const card = document.createElement("article");
    card.className = "authority-card";

    // Header
    const header = document.createElement("div");
    header.className = "authority-header";

    const name = document.createElement("h4");
    name.className = "authority-name";
    name.textContent = auth.name;

    const tag = document.createElement("span");
    tag.className = "authority-verified-tag";
    tag.textContent = "Verified Official Channel";

    header.appendChild(name);
    header.appendChild(tag);
    card.appendChild(header);

    // Coverage note
    if (auth.jurisdiction?.coverageNote) {
      const coverage = document.createElement("p");
      coverage.className = "authority-coverage";
      coverage.textContent = `Coverage: ${auth.jurisdiction.coverageNote}`;
      card.appendChild(coverage);
    }

    // Honest Handoff Disclaimer Box
    const disclaimerBox = document.createElement("div");
    disclaimerBox.className = "authority-disclaimer-box";
    disclaimerBox.setAttribute("role", "note");

    const disclaimerTitle = document.createElement("strong");
    disclaimerTitle.textContent = "Submission Transparency Notice: ";
    disclaimerBox.appendChild(disclaimerTitle);

    const disclaimerBody = document.createTextNode(auth.disclaimer || routeResult.handoffDisclaimer || "SafeRoute has not submitted this report on your behalf. You must use the link above to submit your report directly to the responsible authority.");
    disclaimerBox.appendChild(disclaimerBody);
    card.appendChild(disclaimerBox);

    // Action bar with official external portal link and submission confirmation button
    const actionBar = document.createElement("div");
    actionBar.className = "authority-action-bar";

    const link = document.createElement("a");
    link.href = auth.reportingUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "btn btn-primary authority-link";
    link.appendChild(document.createTextNode("Open Official Reporting Portal ↗ "));
    const srLinkSpan = document.createElement("span");
    srLinkSpan.className = "sr-only";
    srLinkSpan.textContent = "(opens in new tab)";
    link.appendChild(srLinkSpan);

    const confirmSubBtn = document.createElement("button");
    confirmSubBtn.type = "button";
    confirmSubBtn.className = "btn btn-secondary btn-confirm-submission";
    confirmSubBtn.textContent = "I have submitted this report on the official website";

    confirmSubBtn.addEventListener("click", () => {
      activeIncidentStatus = "USER_CONFIRMED_SUBMISSION";
      saveCurrentIncident("USER_CONFIRMED_SUBMISSION");

      confirmSubBtn.replaceWith(createSubmissionConfirmedBanner(auth.name));

      const liveRegion = document.getElementById("analysis-live-region");
      if (liveRegion) {
        liveRegion.textContent = `Report marked as submitted to ${auth.name}.`;
      }
    });

    actionBar.appendChild(link);
    actionBar.appendChild(confirmSubBtn);
    card.appendChild(actionBar);

    // Verification metadata
    if (auth.verificationSource) {
      const meta = document.createElement("p");
      meta.className = "authority-meta";
      meta.textContent = `Verified on ${auth.verificationSource.verifiedDate} by ${auth.verificationSource.verifiedBy} (${auth.verificationSource.url})`;
      card.appendChild(meta);
    }

    fragment.appendChild(card);
  });

  box.appendChild(fragment);
}

function createSubmissionConfirmedBanner(authorityName) {
  const banner = document.createElement("div");
  banner.className = "submission-confirmed-banner";
  banner.textContent = `✓ Submission Confirmed: You confirmed submitting this hazard report to ${authorityName}.`;
  return banner;
}

/**
 * Initialize event listeners
 */
export function initApp() {
  const descInput = document.getElementById("hazard-description");
  const charCounter = document.getElementById("char-counter");
  if (descInput) {
    descInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (charCounter) {
        charCounter.textContent = `${val.length} / 2,000 characters`;
      }
      const isEmergency = detectEmergencyKeywords(val);
      updateEmergencyBanner(isEmergency);
    });
  }

  const form = document.getElementById("hazard-report-form");
  if (form) {
    form.addEventListener("submit", handleReportSubmit);
  }

  const clarifBtn = document.getElementById("submit-clarifications-btn");
  if (clarifBtn) {
    clarifBtn.addEventListener("click", handleClarificationsSubmit);
  }

  const resetBtn = document.getElementById("start-new-report-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetReport);
  }

  const clearSessionBtn = document.getElementById("clear-session-btn");
  if (clearSessionBtn) {
    clearSessionBtn.addEventListener("click", clearAllSessionIncidents);
  }

  const findAuthBtn = document.getElementById("find-authority-btn");
  if (findAuthBtn) {
    findAuthBtn.addEventListener("click", handleFindAuthority);
  }

  // Visual evidence file input listener
  const fileInput = document.getElementById("hazard-image");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileUpload(e.target.files);
      }
    });
  }

  // Visual evidence drag and drop dropzone listeners
  const dropzone = document.getElementById("upload-dropzone");
  if (dropzone) {
    ["dragenter", "dragover"].forEach((evtName) => {
      dropzone.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("upload-dropzone--dragover");
      });
    });

    ["dragleave", "drop"].forEach((evtName) => {
      dropzone.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("upload-dropzone--dragover");
      });
    });

    dropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files);
      }
    });
  }

  renderSessionDashboard();
  loadStaticData();
}

// Auto-initialize in browser DOM environment
if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}

