// One visible session message announcing that redaction is active and how
// to read a placeholder. It is enqueued as a `steer` row when the session is
// created, so it reaches the model together with, and above, the first user
// prompt instead of starting a turn of its own. A `queue` row would be
// promoted separately after the user's turn and provoke an extra model reply.
// Never awaited inside a hook, so it can neither delay nor deadlock redaction.

import { errorFields } from "./logger.js";

export const DISCLOSURE_DESCRIPTION = "opencode-redact is active";

export const DISCLOSURE_TEXT = [
  "opencode-redact removes detected secrets (best effort) from tool output and messages before they reach the model.",
  "A `***REDACTED:...***` placeholder stands in for a removed value and is NOT the real value.",
  "Never write a placeholder into a file, a command, or a message, and do not try to recover or guess the original.",
  "If the task cannot continue without a redacted value, tell the user.",
  "Do not reply to or repeat this notice.",
].join(" ");

const MAX_ATTEMPTS = 2;

/**
 * Each announced session maps to an owner token that is replaced, never
 * mutated, on `forget`, so a late `issue` for a forgotten session can detect
 * that it no longer owns the session and stop.
 *
 * @param {{ synthetic: (input: object) => Promise<unknown>, log: Function }} params
 */
export function createDisclosure({ synthetic, log }) {
  const owners = new Map();

  async function issue(sessionID, owner) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (owners.get(sessionID) !== owner) return;
      try {
        await synthetic({
          sessionID,
          text: DISCLOSURE_TEXT,
          description: DISCLOSURE_DESCRIPTION,
          delivery: "steer",
          resume: false,
        });
        return;
      } catch (err) {
        log("warn", "could not add the redaction disclosure row", {
          attempt,
          gaveUp: attempt === MAX_ATTEMPTS,
          ...errorFields(err),
        });
      }
    }
  }

  const validID = (sessionID) => typeof sessionID === "string" && sessionID.length > 0;

  return {
    /** On `session.created`: adds the row once per session. */
    created(sessionID) {
      if (!validID(sessionID) || owners.has(sessionID)) return;
      const owner = {};
      owners.set(sessionID, owner);
      void issue(sessionID, owner);
    },

    /**
     * On `session.compaction.ended`: the summary may have dropped the row, so add it again.
     * A fresh owner supersedes any earlier retry loop; a session that predates the plugin is announced here.
     */
    compacted(sessionID) {
      if (!validID(sessionID)) return;
      const owner = {};
      owners.set(sessionID, owner);
      void issue(sessionID, owner);
    },

    forget(sessionID) {
      owners.delete(sessionID);
    },
  };
}
