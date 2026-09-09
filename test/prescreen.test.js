// spec: openspec/specs/tool-output-redaction/spec.md
//
// Tests for the anchor-based prescreen, extracted from test/redact.test.js
// alongside src/prescreen.js's extraction from src/redact.js (design.md
// D2) — a pure move, not a behavior change.

import { describe, it, expect } from "vitest";
import { RULE_FIXTURES } from "./fixtures.js";
import { looksLikeSecret } from "../src/prescreen.js";

describe("looksLikeSecret", () => {
  it("does not skip a positive fixture for any rule", () => {
    for (const fixture of RULE_FIXTURES) {
      expect(
        looksLikeSecret(fixture.content),
        `expected looksLikeSecret to return true for rule '${fixture.rule}' fixture`,
      ).toBe(true);
    }
  });

  it("returns false for clean, unremarkable text", () => {
    expect(looksLikeSecret("the quick brown fox jumps over the lazy dog")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(looksLikeSecret("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(looksLikeSecret("AWS_SECRET_ACCESS_KEY=x")).toBe(true);
    expect(looksLikeSecret("aws_secret_access_key=x")).toBe(true);
  });
});
