import crypto from "crypto";

export const MAX_ACTIVE_SESSIONS = 5000;
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_FILES_PER_SESSION = 5;
export const MAX_SESSION_UPLOAD_STORAGE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_GLOBAL_UPLOAD_STORAGE_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// In-memory session store: Map<sessionId, SessionData>
const sessions = new Map();

/**
 * Calculate total in-memory upload bytes across all active sessions
 * @returns {number}
 */
export function getGlobalUploadStorageBytes() {
  let total = 0;
  for (const session of sessions.values()) {
    if (session.files && session.files instanceof Map) {
      for (const file of session.files.values()) {
        total += file.sizeBytes || 0;
      }
    }
  }
  return total;
}

/**
 * Sweep expired sessions from memory
 */
export function sweepExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActive > SESSION_INACTIVITY_MS) {
      sessions.delete(sessionId);
    }
  }
}

/**
 * Get session count (used for monitoring & testing)
 */
export function getActiveSessionCount() {
  return sessions.size;
}

/**
 * Clear all sessions (used in testing)
 */
export function clearAllSessions() {
  sessions.clear();
}

/**
 * Get session data by ID
 * @param {string} sessionId
 */
export function getSession(sessionId) {
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
}

/**
 * Background cleanup interval (runs every 5 minutes)
 */
let cleanupInterval = null;
export function startSessionCleanupTimer() {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(sweepExpiredSessions, 5 * 60 * 1000);
    // Unref so timer doesn't prevent Node from exiting in tests
    if (cleanupInterval.unref) cleanupInterval.unref();
  }
}

export function stopSessionCleanupTimer() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Session management middleware
 */
export function sessionMiddleware(req, res, next) {
  // Reject any request attempting to submit a client-side sessionId in the body
  if (req.body && typeof req.body === "object" && "sessionId" in req.body) {
    return res.status(400).json({
      error: "Bad Request: 'sessionId' field is forbidden in the request body. Sessions are managed via secure cookies only.",
    });
  }

  let sessionId = req.cookies?.session_id;
  const now = Date.now();

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    // Check if expired
    if (now - session.lastActive > SESSION_INACTIVITY_MS) {
      sessions.delete(sessionId);
      sessionId = null;
    } else {
      session.lastActive = now;
      if (!session.files) {
        session.files = new Map();
      }
      req.session = session;
    }
  }

  // Create new session if none exists or previous expired
  if (!sessionId) {
    // Check if session ceiling reached
    if (sessions.size >= MAX_ACTIVE_SESSIONS) {
      sweepExpiredSessions();
      if (sessions.size >= MAX_ACTIVE_SESSIONS) {
        return res.status(503).json({
          error: "Service Temporarily Busy: Active session ceiling reached. Please try again shortly.",
        });
      }
    }

    sessionId = crypto.randomUUID();
    const csrfToken = crypto.randomUUID();

    const newSession = {
      id: sessionId,
      csrfToken: csrfToken,
      createdAt: now,
      lastActive: now,
      confirmedJurisdiction: null,
      incidents: [],
      files: new Map(), // Phase B: Map<fileId, { id, buffer, mimeType, sizeBytes, originalName, uploadedAt }>
    };

    sessions.set(sessionId, newSession);
    req.session = newSession;

    // Set HttpOnly, SameSite=Strict session cookie
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("session_id", sessionId, {
      httpOnly: true,
      sameSite: "strict",
      secure: isProd, // true in production, false for local HTTP dev
      maxAge: SESSION_INACTIVITY_MS,
      path: "/",
    });

    // Set readable CSRF cookie for client-side inclusion in header
    res.cookie("csrf_token", csrfToken, {
      httpOnly: false,
      sameSite: "strict",
      secure: isProd,
      maxAge: SESSION_INACTIVITY_MS,
      path: "/",
    });
  }

  next();
}
