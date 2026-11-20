// Walkers for structured values (tool metadata, tool-call input, JSON tool
// results, host error objects). Every string leaf is scanned; only the
// traversal itself is capped (depth, visit count, cycles) and a capped
// branch is left unscanned with one warning per reason.
//
// `scan(text)` resolves to `{ text, redactionCount, ruleIds }`.

export const STRUCTURED_SCAN_MAX_DEPTH = 128;
export const STRUCTURED_SCAN_MAX_VISITS = 10_000;

const UNCHANGED = Object.freeze({ redactionCount: 0, ruleIds: [] });

export function createScanState(log) {
  return { visits: STRUCTURED_SCAN_MAX_VISITS, ancestors: new WeakSet(), skipped: new Set(), log };
}

function warnSkipped(state, reason) {
  if (state.skipped.has(reason)) return;
  state.skipped.add(reason);
  state.log("warn", "structured redaction skipped", { reason });
}

function visitValue(state) {
  if (state.visits === 0) {
    warnSkipped(state, "visits");
    return false;
  }
  state.visits -= 1;
  return true;
}

function enterContainer(value, state, depth) {
  const reason = state.ancestors.has(value) ? "cycle" : depth >= STRUCTURED_SCAN_MAX_DEPTH ? "depth" : null;
  if (reason) {
    warnSkipped(state, reason);
    return false;
  }
  state.ancestors.add(value);
  return true;
}

async function scanLeaf(text, scan) {
  if (typeof text !== "string" || text.length === 0) return undefined;
  const scanned = await scan(text);
  return scanned.redactionCount > 0 ? scanned : undefined;
}

/**
 * Walks an arbitrary JSON-like value, scanning and redacting every string
 * leaf. Rebuilds arrays and plain objects only when a descendant changed;
 * otherwise returns the original reference. Non-plain objects (class
 * instances) are left untouched.
 *
 * Cyclic back-edges and over-depth branches remain untouched. Tracking the
 * current path, rather than all visited objects, lets shared siblings each
 * receive their own redacted clone without mutating their common source.
 *
 * @returns {Promise<{ value: unknown, redactionCount: number, ruleIds: string[] }>}
 */
export async function redactObjectStrings(value, scan, state, depth = 0) {
  if (!visitValue(state)) return { value, ...UNCHANGED };
  if (typeof value === "string") {
    const scanned = await scanLeaf(value, scan);
    return scanned
      ? { value: scanned.text, redactionCount: scanned.redactionCount, ruleIds: scanned.ruleIds }
      : { value, ...UNCHANGED };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { value, ...UNCHANGED };
    }
  }

  if (!value || typeof value !== "object" || !enterContainer(value, state, depth)) {
    return { value, ...UNCHANGED };
  }

  try {
    let totalCount = 0;
    const ruleIdSet = new Set();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.getOwnPropertyNames(descriptors)) {
      if (Array.isArray(value) && key === "length") continue;
      if (state.visits === 0) {
        warnSkipped(state, "visits");
        break;
      }
      let item;
      try {
        item = value[key];
      } catch {
        visitValue(state);
        continue; // throwing getter; fail open
      }
      const walked = await redactObjectStrings(item, scan, state, depth + 1);
      const descriptor = descriptors[key];
      if ("value" in descriptor) descriptor.value = walked.value;
      else if (walked.redactionCount > 0) {
        descriptors[key] = { value: walked.value, enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: true };
      }
      totalCount += walked.redactionCount;
      for (const ruleId of walked.ruleIds) ruleIdSet.add(ruleId);
    }
    const clone = totalCount === 0 ? value : Array.isArray(value)
      ? Object.defineProperties([], descriptors)
      : Object.create(Object.getPrototypeOf(value), descriptors);
    return { value: clone, redactionCount: totalCount, ruleIds: [...ruleIdSet] };
  } finally {
    state.ancestors.delete(value);
  }
}

/**
 * Redacts string leaves of a value IN PLACE, preserving object identity and
 * prototype. Used for host class instances (a tool error is a Schema.Class)
 * where a plain clone could break the host. Read-only fields that throw on
 * assignment are skipped. Returns the number of leaves redacted.
 */
export async function redactValueInPlace(value, scan, state) {
  let total = 0;
  const walk = async (v, depth) => {
    if (!visitValue(state) || !v || typeof v !== "object" || !enterContainer(v, state, depth)) return;
    try {
      for (const key of Object.getOwnPropertyNames(v)) {
        if (Array.isArray(v) && key === "length") continue;
        if (state.visits === 0) {
          warnSkipped(state, "visits");
          break;
        }
        let item;
        try {
          item = v[key];
        } catch {
          visitValue(state);
          continue; // throwing getter; fail open
        }
        if (item && typeof item === "object") {
          await walk(item, depth + 1);
          continue;
        }
        if (!visitValue(state)) break;
        const scanned = await scanLeaf(item, scan);
        if (scanned) {
          try {
            v[key] = scanned.text;
            total += 1;
          } catch {
            // Host fields can be read-only; preserve the host object.
            continue;
          }
        }
      }
    } finally {
      state.ancestors.delete(v);
    }
  };
  await walk(value, 0);
  return total;
}
