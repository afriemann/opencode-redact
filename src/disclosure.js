// One visible session message announcing that redaction is active and how
// to read a placeholder. Added fire-and-forget the first time a hook is seen
// for a session (and once more after a compaction may have dropped it);
// never awaited inside a hook, so it can neither delay nor deadlock redaction.

import { errorFields } from "./logger.js";

export const DISCLOSURE_DESCRIPTION = "opencode-redact is active";

export const DISCLOSURE_TEXT = [
  "opencode-redact removes detected secrets (best effort) from tool output and messages before they reach the model.",
  "A `***REDACTED:...***` placeholder stands in for a removed value and is NOT the real value.",
  "Never write a placeholder into a file, a command, or a message, and do not try to recover or guess the original.",
  "If the task cannot continue without a redacted value, tell the user.",
].join(" ");

const MAX_ATTEMPTS = 2;

const PENDING = "pending";
const ISSUED = "issued";
const STALE = "stale";

/**
 * Per-session entries are replaced, never mutated, on `forget`, so a late
 * `issue` for a forgotten session can detect it no longer owns the entry.
 *
 * @param {{ synthetic: (input: object) => Promise<unknown>, log: Function }} params
 */
export function createDisclosure({ synthetic, log }) {
  const entries = new Map();

  async function issue(sessionID, entry) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await synthetic({
          sessionID,
          text: DISCLOSURE_TEXT,
          description: DISCLOSURE_DESCRIPTION,
          delivery: "queue",
          resume: false,
        });
        break;
      } catch (err) {
        log("warn", "could not add the redaction disclosure row", {
          attempt,
          gaveUp: attempt === MAX_ATTEMPTS,
          ...errorFields(err),
        });
      }
    }
    if (entries.get(sessionID) !== entry) return;
    entry.phase = entry.compacted ? STALE : ISSUED;
    entry.compacted = false;
  }

  return {
    /** Call from a hook that carries a session ID; adds the row at most once per session. */
    touch(sessionID) {
      if (typeof sessionID !== "string" || sessionID.length === 0) return;
      const current = entries.get(sessionID);
      if (current && current.phase !== STALE) return;
      const entry = { phase: PENDING, compacted: false };
      entries.set(sessionID, entry);
      void issue(sessionID, entry);
    },

    /** A compaction can drop the row: add it again at the next hook. */
    markCompacted(sessionID) {
      const entry = entries.get(sessionID);
      if (!entry) return;
      if (entry.phase === ISSUED) entry.phase = STALE;
      else if (entry.phase === PENDING) entry.compacted = true;
    },

    forget(sessionID) {
      entries.delete(sessionID);
    },
  };
}
