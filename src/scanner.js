// Per-session scan memo. A completed scan of identical input yields
// byte-identical redacted text, so the request prefix stays stable across
// calls even if a later scan would fail or time out.
//
// Only completed scans are stored (`ok`): a timeout or scanner error reports
// `redactionCount: 0` exactly like a clean scan and must be retried. Keys are
// SHA-256 digests (never the text), values hold redacted output only, so the
// memo never retains a detected secret. Digests are never logged.

import { createHash } from "node:crypto";
import { scanAndRedact, redactUserMessage } from "./redact.js";

const MAX_ENTRIES_PER_SESSION = 4096;
const MAX_CHARS_PER_SESSION = 2_000_000;
const MAX_TRACKED_SESSIONS = 32;

function memoKey(text, honorNoRedact, configId) {
  return createHash("sha256").update(`${honorNoRedact ? 1 : 0}\0${configId}\0`).update(text).digest("hex");
}

function newSession() {
  return { entries: new Map(), chars: 0, inflight: new Map(), warnedIncomplete: false };
}

/**
 * @param {{
 *   lint: (text: string) => Promise<unknown[]>,
 *   configId?: string,
 *   maxEntries?: number,
 *   maxChars?: number,
 *   maxSessions?: number,
 *   log?: Function,
 * }} params `configId` identifies the linter configuration, so a memo can
 *   never outlive a configuration change.
 */
export function createScanner({
  lint,
  configId = "",
  maxEntries = MAX_ENTRIES_PER_SESSION,
  maxChars = MAX_CHARS_PER_SESSION,
  maxSessions = MAX_TRACKED_SESSIONS,
  log = () => {},
}) {
  const sessions = new Map();

  function sessionState(sessionID) {
    let state = sessions.get(sessionID);
    if (state) {
      sessions.delete(sessionID);
    } else {
      state = newSession();
    }
    sessions.set(sessionID, state);
    while (sessions.size > maxSessions) {
      sessions.delete(sessions.keys().next().value);
    }
    return state;
  }

  function remember(state, key, result) {
    const chars = result.redactionCount > 0 ? result.text.length : 0;
    state.entries.set(key, { redacted: result.redactionCount > 0 ? result.text : null, redactionCount: result.redactionCount, ruleIds: result.ruleIds, chars });
    state.chars += chars;
    while (state.entries.size > maxEntries || state.chars > maxChars) {
      const [oldestKey, oldest] = state.entries.entries().next().value;
      state.entries.delete(oldestKey);
      state.chars -= oldest.chars;
    }
  }

  async function compute(text, honorNoRedact, state) {
    const result = honorNoRedact ? await redactUserMessage(text, { lint }) : await scanAndRedact(text, { lint });
    if (!result.ok && !state?.warnedIncomplete) {
      if (state) state.warnedIncomplete = true;
      log("warn", "scan incomplete; text may not be fully redacted");
    }
    return result;
  }

  /**
   * Scans `text`, honouring the user-role `noredact` fence when
   * `honorNoRedact` is set. Returns `{ text, redactionCount, ruleIds, ok }`.
   */
  async function scan(text, { sessionID, honorNoRedact = false } = {}) {
    if (typeof text !== "string" || text.length === 0 || sessionID === undefined) {
      return compute(text, honorNoRedact);
    }

    const state = sessionState(sessionID);
    const key = memoKey(text, honorNoRedact, configId);

    const hit = state.entries.get(key);
    if (hit) {
      state.entries.delete(key);
      state.entries.set(key, hit);
      return { text: hit.redacted ?? text, redactionCount: hit.redactionCount, ruleIds: hit.ruleIds, ok: true };
    }

    const pending = state.inflight.get(key);
    if (pending) {
      const shared = await pending;
      return { ...shared, text: shared.redactionCount > 0 ? shared.text : text };
    }

    const running = compute(text, honorNoRedact, state);
    state.inflight.set(key, running);
    try {
      const result = await running;
      if (result.ok) remember(state, key, result);
      return result;
    } finally {
      state.inflight.delete(key);
    }
  }

  return {
    scan,
    forget: (sessionID) => void sessions.delete(sessionID),
    clear: () => sessions.clear(),
  };
}
