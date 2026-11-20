// Structured diagnostics. V2's plugin context has no log method, so every
// entry is one JSON line on stderr: constant `message`, variable data in
// `extra`. Entries never carry scanned content, raw error messages or stacks;
// callers pass an error class or code (see `errorFields`) instead.

export const SERVICE_NAME = "opencode-redact";

export const LOG_LEVEL_ENV = "OPENCODE_REDACT_LOG_LEVEL";

const LEVELS = ["debug", "info", "warn", "error"];
const DEFAULT_LEVEL = "info";

/** The only parts of an error that are safe to log: its class and code. */
export function errorFields(err) {
  const fields = { errorClass: err?.constructor?.name ?? typeof err };
  if (typeof err?.code === "string" || typeof err?.code === "number") {
    fields.errorCode = err.code;
  }
  return fields;
}

/**
 * Returns `log(level, message, extra?)`; it never throws. Entries below the
 * minimum level (`OPENCODE_REDACT_LOG_LEVEL`, default `info`) are dropped.
 */
export function createLogger({ write = (line) => process.stderr.write(line), minLevel = process.env[LOG_LEVEL_ENV] } = {}) {
  const threshold = LEVELS.includes(minLevel) ? LEVELS.indexOf(minLevel) : LEVELS.indexOf(DEFAULT_LEVEL);
  return (level, message, extra) => {
    try {
      if (LEVELS.indexOf(level) < threshold) return;
      const entry = { service: SERVICE_NAME, level, message };
      if (extra !== undefined) entry.extra = extra;
      write(`${JSON.stringify(entry)}\n`);
    } catch {
      // Diagnostics must never interrupt redaction.
    }
  };
}
