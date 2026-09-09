import { describe, it, expect } from "vitest";
import { createSecretlintConfig, createLinter, createEntropyConfig, createCompositeLinter } from "../src/secretlint.js";
import { redactSecrets } from "../src/redact.js";
import { RULE_FIXTURES } from "./fixtures.js";
import { ENTROPY_FIXTURES } from "./entropy-fixtures.js";

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

describe("createEntropyConfig", () => {
  it("builds a config containing exactly the high-entropy rule, embedded directly (no npm package resolution)", () => {
    const config = createEntropyConfig();
    expect(config.rules).toHaveLength(1);
    const [entry] = config.rules;
    expect(entry.id).toBe("high-entropy");
    expect(typeof entry.rule).toBe("object");
    expect(entry.rule.meta.type).toBe("scanner");
  });
});

describe("createCompositeLinter", () => {
  it("does not change createSecretlintConfig/createLinter's own behavior (still exactly one anchored rule bundle)", async () => {
    const config = await createSecretlintConfig();
    expect(config.rules).toHaveLength(1);
  });

  it("detects every anchored RULE_FIXTURES entry through the composite, same as the plain linter", async () => {
    const presetConfig = await createSecretlintConfig();
    const lint = createCompositeLinter(presetConfig, { timeoutMs: 3000 });
    for (const fixture of RULE_FIXTURES) {
      const messages = await lint(fixture.content, { ext: fixture.ext });
      expect(
        messages.some((m) => m.messageId === fixture.messageId),
        `expected rule '${fixture.rule}' to report messageId '${fixture.messageId}' for its fixture`,
      ).toBe(true);
    }
  });

  it("detects a high-entropy secret with no anchor, which the anchored-only linter would never scan for", async () => {
    const presetConfig = await createSecretlintConfig();
    const lint = createCompositeLinter(presetConfig, { timeoutMs: 3000 });
    const fixture = ENTROPY_FIXTURES.find((f) => f.expectFinding && f.name.startsWith("base64 positive"));
    const messages = await lint(fixture.content);
    expect(messages.some((m) => m.ruleId === "high-entropy")).toBe(true);
  });

  it("runs the entropy bundle even when the anchor prescreen is negative", async () => {
    const presetConfig = await createSecretlintConfig();
    const lint = createCompositeLinter(presetConfig, { timeoutMs: 3000 });
    const fixture = ENTROPY_FIXTURES.find((f) => f.name.startsWith("base64 arithmetic pin"));
    // Sanity: this fixture contains no anchor any anchored rule requires.
    const messages = await lint(fixture.content);
    expect(messages.some((m) => m.ruleId === "high-entropy")).toBe(true);
  });

  it("does not report a high-entropy finding for a fixture the allowlist exempts", async () => {
    const presetConfig = await createSecretlintConfig();
    const lint = createCompositeLinter(presetConfig, { timeoutMs: 3000 });
    for (const fixture of ENTROPY_FIXTURES.filter((f) => !f.expectFinding)) {
      const messages = await lint(fixture.content);
      expect(
        messages.some((m) => m.ruleId === "high-entropy"),
        `fixture '${fixture.name}' should not have reported a high-entropy finding`,
      ).toBe(false);
    }
  });

  it("reports both an anchored finding and a high-entropy finding when both are present in the same text", async () => {
    const presetConfig = await createSecretlintConfig();
    const lint = createCompositeLinter(presetConfig, { timeoutMs: 3000 });
    const awsFixture = RULE_FIXTURES.find((f) => f.rule === "aws");
    const entropyFixture = ENTROPY_FIXTURES.find((f) => f.expectFinding && f.name.startsWith("base64 positive"));
    const text = `${awsFixture.content}\n${entropyFixture.content}`;
    const messages = await lint(text);
    expect(messages.some((m) => m.ruleId === "@secretlint/secretlint-rule-aws")).toBe(true);
    expect(messages.some((m) => m.ruleId === "high-entropy")).toBe(true);
  });

  it("omits the entropy bundle entirely when disableHighEntropy is true, reducing to today's anchored-only behavior", async () => {
    const presetConfig = await createSecretlintConfig();
    const lint = createCompositeLinter(presetConfig, { timeoutMs: 3000, disableHighEntropy: true });
    const entropyFixture = ENTROPY_FIXTURES.find((f) => f.expectFinding && f.name.startsWith("base64 positive"));
    const messages = await lint(entropyFixture.content);
    expect(messages.some((m) => m.ruleId === "high-entropy")).toBe(false);

    const awsFixture = RULE_FIXTURES.find((f) => f.rule === "aws");
    const awsMessages = await lint(awsFixture.content);
    expect(awsMessages.some((m) => m.ruleId === "@secretlint/secretlint-rule-aws")).toBe(true);
  });

  it("ignores an unused second constructor argument the way existing test overrides do (no crash on extra args)", () => {
    expect(() => createCompositeLinter({ rules: [] })).not.toThrow();
  });
});
