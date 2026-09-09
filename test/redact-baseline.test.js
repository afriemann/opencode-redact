// Permanent proof that `redactSecrets` (and, once extracted, `scanAndRedact`
// via the wrapper) remains behavior-preserving across every refactor made in
// this change. See design.md D8: this baseline was generated from the
// UNMODIFIED pre-refactor implementation and committed before any further
// edit to src/redact.js. A failure here means the live implementation
// diverged from the pre-refactor behavior — investigate and fix the
// regression; never regenerate this baseline to make the test pass.
//
// The baseline JSON deliberately stores no `input` field (see
// scripts/generate-redact-baseline.mjs's header for why — persisting a real
// fixture's secret-shaped input a second time outside test/fixtures.js would
// trip GitHub push protection). `input` is re-derived here from
// test/corpus.js by matching each baseline entry's `name`.
//
// spec: openspec/specs/tool-output-redaction/spec.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { createSecretlintConfig, createLinter } from "../src/secretlint.js";
import { redactSecrets } from "../src/redact.js";
import { REAL_FIXTURE_ENTRIES, STUB_ENTRIES } from "./corpus.js";
import { decodeValue } from "./baseline-codec.js";

const BASELINE_PATH = fileURLToPath(new URL("./__baseline__/redact-secrets.baseline.json", import.meta.url));

describe("redactSecrets refactor-safety baseline", () => {
  it("matches the committed pre-refactor baseline for every corpus entry", async () => {
    // Reminder (see test/corpus.js's own header for the full rule): never
    // edit an existing corpus entry or regenerate this baseline to make a
    // failing assertion pass — a mismatch here is a regression to
    // investigate and fix in the implementation, not in the fixture data.
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    const config = await createSecretlintConfig();
    const realLint = createLinter(config);
    const inputByName = new Map(
      [...REAL_FIXTURE_ENTRIES, ...STUB_ENTRIES].map((entry) => [entry.name, entry.input]),
    );
    const stubLintByName = new Map(STUB_ENTRIES.map((entry) => [entry.name, entry.lint]));

    expect(baseline.length).toBeGreaterThan(0);

    for (const entry of baseline) {
      expect(inputByName.has(entry.name), `no corpus entry found for baseline entry '${entry.name}'`).toBe(true);
      const input = inputByName.get(entry.name);
      const lint = entry.ext !== null ? (text) => realLint(text, { ext: entry.ext }) : stubLintByName.get(entry.name);
      expect(lint, `no lint function found for baseline entry '${entry.name}'`).toBeTypeOf("function");

      const result = await redactSecrets(input, { lint });

      expect(result.text, `text mismatch for '${entry.name}'`).toEqual(decodeValue(entry.text));
      expect(result.redactionCount, `redactionCount mismatch for '${entry.name}'`).toBe(entry.redactionCount);
      expect(result.ruleIds, `ruleIds mismatch for '${entry.name}'`).toEqual(entry.ruleIds);
    }
  });
});
