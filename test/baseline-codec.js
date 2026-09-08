// Shared JSON encode/decode helpers for the refactor-safety baseline (see
// design.md D8). JSON.stringify silently drops `undefined`-valued
// properties, which would make `redactSecrets(undefined, ...)` returning
// `{ text: undefined, ... }` indistinguishable from a missing field. These
// helpers round-trip `undefined` through an explicit sentinel object instead.

const UNDEFINED_SENTINEL = { __undefined__: true };

export function encodeValue(value) {
  return value === undefined ? UNDEFINED_SENTINEL : value;
}

export function decodeValue(value) {
  return value !== null && typeof value === "object" && value.__undefined__ === true ? undefined : value;
}
