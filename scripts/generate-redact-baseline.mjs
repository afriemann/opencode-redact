#!/usr/bin/env node
// One-shot generator for the refactor-safety baseline (see design.md D8).
//
// Run this exactly once, against the UNMODIFIED pre-refactor `redactSecrets`
// implementation, and commit its output (test/__baseline__/redact-secrets.baseline.json)
// BEFORE making any further edit to src/redact.js. Git history then proves
// the baseline captured the behavior of the code as it existed prior to the
// scanAndRedact extraction — the permanent assertion test
// (test/redact-baseline.test.js) diffs the live implementation against this
// file forever after.
//
// Do NOT re-run this script once the baseline is committed. A diff between
// the live implementation and the baseline is a regression to investigate
// and fix, never a snapshot to regenerate (see design.md D8 for why a
// `vitest -u`-style "update the snapshot" workflow is rejected here).
//
// The baseline intentionally stores only `{ name, ext, text, redactionCount,
// ruleIds }` per entry — never the raw `input`. Every real-fixture `input`
// value is itself a live secret-shaped literal (by design, to trigger a real
// secretlint rule); persisting it a second time into this JSON file would
// duplicate that content outside test/fixtures.js and trip GitHub's push
// protection / secret scanning on this repo. `input` is instead re-derived
// at comparison time directly from test/corpus.js by matching on `name` (see
// test/redact-baseline.test.js) — it never needs to be persisted because it
// is already fully determined by the corpus module, which is version
// controlled independently.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSecretlintConfig, createLinter } from "../src/secretlint.js";
import { redactSecrets } from "../src/redact.js";
import { REAL_FIXTURE_ENTRIES, STUB_ENTRIES } from "../test/corpus.js";
import { encodeValue } from "../test/baseline-codec.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUTPUT_PATH = join(HERE, "..", "test", "__baseline__", "redact-secrets.baseline.json");

async function main() {
  const config = await createSecretlintConfig();
  const realLint = createLinter(config);

  const entries = [];

  for (const { name, input, ext } of REAL_FIXTURE_ENTRIES) {
    const lint = (text) => realLint(text, { ext });
    const result = await redactSecrets(input, { lint });
    entries.push({
      name,
      ext,
      text: encodeValue(result.text),
      redactionCount: result.redactionCount,
      ruleIds: result.ruleIds,
    });
  }

  for (const { name, input, lint } of STUB_ENTRIES) {
    const result = await redactSecrets(input, { lint });
    entries.push({
      name,
      ext: null,
      text: encodeValue(result.text),
      redactionCount: result.redactionCount,
      ruleIds: result.ruleIds,
    });
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  console.log(`wrote ${entries.length} baseline entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
