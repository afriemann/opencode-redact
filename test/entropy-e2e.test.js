// spec: openspec/specs/high-entropy-secret-detection/spec.md
// spec: openspec/specs/tool-output-redaction/spec.md
// spec: openspec/specs/user-message-redaction/spec.md
//
// End-to-end detection through the real composite linter and the V2 hooks.

import { describe, it, expect, afterEach } from "vitest";
import { RULE_FIXTURES } from "./fixtures.js";
import { ENTROPY_FIXTURES, SHORT_PASSWORD_FIXTURES } from "./entropy-fixtures.js";
import { loadV2 } from "./host.js";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()();
});

async function load(overrides) {
  const host = await loadV2(overrides);
  cleanups.push(host.cleanup);
  const toolOutput = async (text) => {
    const event = { tool: "bash", sessionID: "s1", status: "completed", result: { content: text } };
    await host.hooks["execute.after"](event);
    return event.result.content;
  };
  const userMessage = async (text) => {
    const event = { sessionID: "s1", prompt: { text } };
    await host.hooks.prompt(event);
    return event.prompt.text;
  };
  return { toolOutput, userMessage };
}

const PLACEHOLDER = "***REDACTED:high-entropy***";
const entropyFixture = ENTROPY_FIXTURES.find((f) => f.expectFinding && f.name.startsWith("base64 positive"));
const jwtFixture = ENTROPY_FIXTURES.find((f) => f.name.startsWith("signed JWT"));

describe("high-entropy secret detection (end-to-end)", () => {
  it("Absent, false, or unusable configuration leaves high-entropy detection enabled", async () => {
    const { toolOutput } = await load({ _loadPluginConfigOverride: async () => ({ disableHighEntropy: false }) });
    expect(await toolOutput(entropyFixture.content)).toContain("***REDACTED:high-entropy***");
  });

  it("redacts a bespoke high-entropy secret with no vendor anchor in tool output", async () => {
    const { toolOutput } = await load();
    const text = await toolOutput(entropyFixture.content);
    expect(text).toContain(PLACEHOLDER);
    expect(text).not.toContain(entropyFixture.content);
  });

  it("redacts a bespoke high-entropy secret with no vendor anchor in a user message", async () => {
    const { userMessage } = await load();
    const text = await userMessage(entropyFixture.content);
    expect(text).toContain(PLACEHOLDER);
    expect(text).not.toContain(entropyFixture.content);
  });

  it("leaves every allowlisted fixture (git SHA, UUID, hash digest, SRI hash) unredacted in tool output", async () => {
    const { toolOutput } = await load();
    for (const fixture of ENTROPY_FIXTURES.filter((f) => !f.expectFinding && !f.name.startsWith("unsigned JWT"))) {
      expect(await toolOutput(fixture.content), `fixture '${fixture.name}' should not have been redacted`).toBe(fixture.content);
    }
  });

  it("redacts a signed JWT as a single placeholder covering the whole token", async () => {
    const { toolOutput } = await load();
    const text = await toolOutput(jwtFixture.content);
    expect(text).not.toContain(jwtFixture.content);
    expect(text.match(/\*\*\*REDACTED:high-entropy\*\*\*/g) ?? []).toHaveLength(1);
  });

  it("leaves an unsigned (alg: none) JWT completely unredacted", async () => {
    const { toolOutput } = await load();
    const fixture = ENTROPY_FIXTURES.find((f) => f.name.startsWith("unsigned JWT"));
    expect(await toolOutput(fixture.content)).toBe(fixture.content);
  });

  it("still detects every anchored RULE_FIXTURES entry alongside the entropy rule", async () => {
    const { toolOutput } = await load();
    for (const fixture of RULE_FIXTURES) {
      expect(await toolOutput(fixture.content), `fixture '${fixture.rule}' should have been redacted`).toContain("***REDACTED:");
    }
  });

  it("Explicit true disables high-entropy detection (anchored rules still fire)", async () => {
    const { toolOutput } = await load({ _loadPluginConfigOverride: async () => ({ disableHighEntropy: true }) });
    expect(await toolOutput(entropyFixture.content)).toBe(entropyFixture.content);
    const aws = RULE_FIXTURES.find((f) => f.rule === "aws");
    expect(await toolOutput(aws.content)).toContain("***REDACTED:");
  });
});

describe("short password-shaped secret detection (end-to-end)", () => {
  const genuine = SHORT_PASSWORD_FIXTURES.find((f) => f.name.startsWith("P1"));
  const entropyGuard = SHORT_PASSWORD_FIXTURES.find((f) => f.name.startsWith("N6"));
  const runCapGuard = SHORT_PASSWORD_FIXTURES.find((f) => f.name.startsWith("N7"));

  it("redacts a genuine short password-shaped secret in tool output", async () => {
    const { toolOutput } = await load();
    const text = await toolOutput(genuine.content);
    expect(text).toContain(PLACEHOLDER);
    expect(text).not.toContain(genuine.content);
  });

  it("redacts a genuine short password-shaped secret in a user message", async () => {
    const { userMessage } = await load();
    const text = await userMessage(genuine.content);
    expect(text).toContain(PLACEHOLDER);
    expect(text).not.toContain(genuine.content);
  });

  it("does not redact an identifier rejected by the entropy threshold alone", async () => {
    const { toolOutput } = await load();
    expect(await toolOutput(entropyGuard.content)).toBe(entropyGuard.content);
  });

  it("does not redact an identifier rejected by the class-run cap alone", async () => {
    const { toolOutput } = await load();
    expect(await toolOutput(runCapGuard.content)).toBe(runCapGuard.content);
  });

  it("matches every SHORT_PASSWORD_FIXTURES entry", async () => {
    const { toolOutput } = await load();
    for (const fixture of SHORT_PASSWORD_FIXTURES) {
      const text = await toolOutput(fixture.content);
      if (fixture.expectFinding) {
        expect(text, `fixture '${fixture.name}' should have been redacted`).toContain("***REDACTED:");
      } else {
        expect(text, `fixture '${fixture.name}' should not have been redacted`).toBe(fixture.content);
      }
    }
  });
});
