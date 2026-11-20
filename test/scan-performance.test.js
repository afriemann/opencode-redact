import { describe, expect, it } from "vitest";
import { createCompositeLinter, createSecretlintConfig } from "../src/secretlint.js";
import { scanAndRedact } from "../src/redact.js";
import { RULE_FIXTURES } from "./fixtures.js";

const aws = RULE_FIXTURES.find((f) => f.rule === "aws");

describe("scan performance", () => {
  it("A 200000-character scan finishes within one second", async () => {
    const lint = createCompositeLinter(await createSecretlintConfig());
    const filler = "see https://example.com/a/b/c and /usr/local/lib/x 12345 and some prose here\n";
    const text = filler.repeat(Math.ceil(200_000 / filler.length)) + aws.content;
    const started = performance.now();
    const result = await scanAndRedact(text, { lint });
    const elapsed = performance.now() - started;
    expect(result.redactionCount).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});
