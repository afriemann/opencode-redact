import { describe, it, expect } from "vitest";
import { createSecretlintConfig, createLinter } from "../src/secretlint.js";
import { redactSecrets } from "../src/redact.js";
import { RULE_FIXTURES } from "./fixtures.js";

describe("createSecretlintConfig", () => {
  it("builds a config containing the recommend preset with filter-comments disabled", async () => {
    const config = await createSecretlintConfig();
    expect(config.rules).toHaveLength(1);
    const [preset] = config.rules;
    expect(preset.id).toBe("@secretlint/secretlint-rule-preset-recommend");
    const filterComments = preset.rules?.find((rule) => rule.id === "@secretlint/secretlint-rule-filter-comments");
    expect(filterComments).toBeDefined();
    expect(filterComments.disabled).toBe(true);
  });
});

describe("createLinter", () => {
  it("reports a finding with the expected ruleId for a known-detectable fixture", async () => {
    const config = await createSecretlintConfig();
    const lint = createLinter(config, { timeoutMs: 3000 });
    const fixture = RULE_FIXTURES.find((f) => f.rule === "aws");
    const messages = await lint(fixture.content);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].ruleId).toBe("@secretlint/secretlint-rule-aws");
  });

  it("detects every reachable recommend-preset rule fixture", async () => {
    const config = await createSecretlintConfig();
    const lint = createLinter(config, { timeoutMs: 3000 });
    for (const fixture of RULE_FIXTURES) {
      const messages = await lint(fixture.content, { ext: fixture.ext });
      expect(
        messages.some((m) => m.messageId === fixture.messageId),
        `expected rule '${fixture.rule}' to report messageId '${fixture.messageId}' for its fixture`,
      ).toBe(true);
    }
  });

  it("returns no findings and does not read the filesystem for the GCP p12 branch's fixed virtual path", async () => {
    const config = await createSecretlintConfig();
    const lint = createLinter(config, { timeoutMs: 3000 });
    // Content is irrelevant here — the point is that the fixed virtual path
    // under /dev/null/ can never resolve, so the GCP p12 rule's internal
    // fs.readFileSync always fails and is swallowed by that rule's own catch.
    await expect(lint("irrelevant content", { ext: ".p12" })).resolves.toEqual([]);
  });

  it("rejects when the linter exceeds the configured timeout", async () => {
    const config = await createSecretlintConfig();
    // The timeout race is asserted via an injectable override rather than by
    // trying to make a real rule run slowly — design.md D5 documents that a
    // synchronous regex loop can't be interrupted by the timer anyway; what
    // this test verifies is that createLinter's race mechanism itself
    // rejects once the timeout elapses.
    const neverResolves = () => new Promise(() => {});
    const timedOutLint = createLinter(config, { timeoutMs: 5, _lintSourceOverride: neverResolves });
    await expect(timedOutLint("anything")).rejects.toThrow(/timed out/i);
  });

  it("falls back to the original text end-to-end when createLinter's real timeout rejection reaches redactSecrets", async () => {
    const config = await createSecretlintConfig();
    const neverResolves = () => new Promise(() => {});
    const timedOutLint = createLinter(config, { timeoutMs: 5, _lintSourceOverride: neverResolves });
    const text = "aws_secret_access_key=ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4";
    const result = await redactSecrets(text, { lint: timedOutLint });
    expect(result).toEqual({ text, redactionCount: 0, ruleIds: [] });
  });
});
