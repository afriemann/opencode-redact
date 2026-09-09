// Deterministic fixture corpus used to prove `scanAndRedact`/`redactSecrets`
// are behavior-preserving across the refactor in this change (see
// design.md D8). `REAL_FIXTURE_ENTRIES` scan through the actual secretlint
// linter (built via `createLinter`) with `ext` fixed per fixture, matching
// `RULE_FIXTURES`. `STUB_ENTRIES` use a canned lint function returning fixed
// messages, covering edge cases (malformed/overlapping/adjacent/partial
// ranges, no-findings, non-scannable input) that don't depend on real rule
// behavior. Every stub input that must reach the linter is deliberately
// constructed to contain a `looksLikeSecret` anchor (the literal word
// "secret") so the prescreen does not short-circuit it.
//
// This file must remain stable once the baseline (see
// scripts/generate-redact-baseline.mjs) has been generated and committed —
// changing an entry here without regenerating the baseline would make the
// permanent assertion test (test/redact-baseline.test.js) compare against
// stale expectations. Only ever append new entries; never edit or remove an
// existing one without regenerating the baseline from an intentional,
// reviewed behavior change.

import { RULE_FIXTURES } from "./fixtures.js";

export const REAL_FIXTURE_ENTRIES = RULE_FIXTURES.map((fixture) => ({
  name: `real:${fixture.rule}`,
  input: fixture.content,
  ext: fixture.ext,
}));

function stub(messages) {
  return async () => messages;
}

export const STUB_ENTRIES = [
  { name: "empty string", input: "", lint: stub([]) },
  { name: "undefined input", input: undefined, lint: stub([]) },
  { name: "non-string number", input: 42, lint: stub([]) },
  {
    name: "clean text (prescreen negative)",
    input: "the quick brown fox jumps over the lazy dog",
    lint: stub([]),
  },
  {
    name: "no findings reported by scanner",
    input: "token: AAAAAAAAAAAAAAAAAAAA secret_value",
    lint: stub([]),
  },
  {
    name: "multi-finding two non-overlapping rules",
    input: "secret_one=AAAAAAAAAA middle secret_two=BBBBBBBBBB",
    lint: stub([
      { ruleId: "@secretlint/secretlint-rule-one", range: [11, 21] },
      { ruleId: "@secretlint/secretlint-rule-two", range: [39, 49] },
    ]),
  },
  {
    name: "overlapping-range findings merge to one placeholder",
    input: "secret_value=XXXXXXXXXXXXXXXXXXXX",
    lint: stub([
      { ruleId: "@secretlint/secretlint-rule-aws", range: [13, 25] },
      { ruleId: "@secretlint/secretlint-rule-privatekey", range: [21, 33] },
    ]),
  },
  {
    name: "adjacent-in-token findings merge to one placeholder",
    input: "secret AAAAAAAAAABBBBBBBBBB",
    lint: stub([
      { ruleId: "@secretlint/secretlint-rule-one", range: [7, 17] },
      { ruleId: "@secretlint/secretlint-rule-two", range: [17, 27] },
    ]),
  },
  {
    name: "partial-range finding expands to token boundary",
    input: "secret prefix ABCDEF12345 suffix",
    lint: stub([{ ruleId: "@secretlint/secretlint-rule-example", range: [16, 24] }]),
  },
  {
    name: "malformed-range findings are dropped without throwing",
    input: "hello secret world",
    lint: stub([
      { ruleId: "bad", range: [5, 2] },
      { ruleId: "bad2", range: [-1, 3] },
      { ruleId: "bad3", range: [0, 1000] },
    ]),
  },
];
