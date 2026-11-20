// spec: openspec/specs/scan-performance/spec.md
import { describe, it, expect } from "vitest";
import { planSlices } from "../src/slicing.js";
import { createSecretlintConfig, createCompositeLinter } from "../src/secretlint.js";
import { scanAndRedact } from "../src/redact.js";
import { RULE_FIXTURES } from "./fixtures.js";
import { ENTROPY_FIXTURES } from "./entropy-fixtures.js";

const SLICE = { sliceChars: 1000, overlapChars: 300 };

describe("planSlices", () => {
  it("returns one slice covering a short text", () => {
    expect(planSlices("short text", SLICE)).toEqual([{ start: 0, end: 10 }]);
  });

  it("covers the whole text with overlapping slices that start after a delimiter", () => {
    const text = Array.from({ length: 400 }, (_, i) => `line-${i}`).join("\n");
    const slices = planSlices(text, SLICE);
    expect(slices.length).toBeGreaterThan(1);
    expect(slices[0].start).toBe(0);
    expect(slices.at(-1).end).toBe(text.length);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i].start).toBeLessThan(slices[i - 1].end);
      expect(slices[i].start).toBeGreaterThan(slices[i - 1].start);
      expect(text[slices[i].start - 1]).toBe("\n");
      expect(text[slices[i - 1].end]).toBe("\n");
    }
  });

  it("hard-cuts an unbroken run with overlap and still terminates", () => {
    const slices = planSlices("x".repeat(5000), SLICE);
    expect(slices.at(-1).end).toBe(5000);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i - 1].end - slices[i].start).toBeGreaterThanOrEqual(SLICE.overlapChars);
    }
  });

  it("keeps at least the overlap when whitespace is sparse near the cut", () => {
    const text = `${"x".repeat(150)} ${"y".repeat(150)} ${"z".repeat(400)}`;
    const slices = planSlices(text, SLICE);
    for (let i = 1; i < slices.length; i += 1) {
      expect(slices[i - 1].end - slices[i].start).toBeGreaterThanOrEqual(SLICE.overlapChars);
    }
  });

  it("does not keep an oversized armored block whole", () => {
    const text = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(40_000)}\n-----END PRIVATE KEY-----`;
    const slices = planSlices(text, { sliceChars: 1000, overlapChars: 100 });
    expect(Math.max(...slices.map((s) => s.end - s.start))).toBeLessThanOrEqual(1000);
  });

  it("keeps a PEM block within one slice wherever the window would end", () => {
    const block = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(60).concat("\n").repeat(40)}-----END PRIVATE KEY-----`;
    for (let pad = 0; pad < 1000; pad += 97) {
      const text = `${"y\n".repeat(pad / 2)}${block}\n${"z\n".repeat(600)}`;
      const start = text.indexOf("-----BEGIN");
      const end = text.indexOf("-----END") + "-----END PRIVATE KEY-----".length;
      const slices = planSlices(text, SLICE);
      expect(slices.some((s) => s.start <= start && s.end >= end), `pad ${pad}`).toBe(true);
    }
  });
});

describe("sliced composite linter", () => {
  const awsFixture = RULE_FIXTURES.find((f) => f.rule === "aws").content;
  const pemFixture = RULE_FIXTURES.find((f) => f.rule === "privatekey").content;
  const entropyFixture = ENTROPY_FIXTURES.find((f) => f.expectFinding && f.name.startsWith("base64 positive")).content;

  async function linters() {
    const config = await createSecretlintConfig();
    return {
      unsliced: createCompositeLinter(config, { sliceChars: 10_000_000, overlapChars: 0 }),
      sliced: createCompositeLinter(config, SLICE),
    };
  }

  it("A secret at every slice offset is found", async () => {
    const { unsliced, sliced } = await linters();
    for (const secret of [awsFixture, entropyFixture]) {
      for (let offset = 0; offset < 1000; offset += 37) {
        const filler = "lorem ipsum dolor sit amet\n".repeat(80);
        const text = `${filler.slice(0, offset)}\nvalue ${secret}\n${filler}`;
        const expected = await scanAndRedact(text, { lint: unsliced });
        const actual = await scanAndRedact(text, { lint: sliced });
        expect(actual.text, `offset ${offset}`).toBe(expected.text);
        expect(actual.redactionCount).toBeGreaterThan(0);
      }
    }
  });

  it("A private-key block is redacted whole", async () => {
    const { sliced } = await linters();
    for (let offset = 0; offset < 1000; offset += 53) {
      const text = `${"clean line here\n".repeat(offset / 16 + 1)}${pemFixture}\n${"clean line here\n".repeat(200)}`;
      const result = await scanAndRedact(text, { lint: sliced });
      expect(result.text, `offset ${offset}`).not.toContain("-----BEGIN");
      expect(result.text).not.toContain("-----END");
    }
  });

  it("matches an unsliced scan over every rule fixture and entropy fixture", async () => {
    const { unsliced, sliced } = await linters();
    const parts = [...RULE_FIXTURES.filter((f) => f.rule !== "gcp").map((f) => f.content), ...ENTROPY_FIXTURES.map((f) => f.content)];
    const text = parts.map((part) => `${"filler words go here\n".repeat(30)}${part}`).join("\n");
    const expected = await scanAndRedact(text, { lint: unsliced });
    const actual = await scanAndRedact(text, { lint: sliced });
    expect(actual.text).toBe(expected.text);
    expect(actual.redactionCount).toBe(expected.redactionCount);
  });

  it("A large scan yields", async () => {
    const lint = createCompositeLinter({ rules: [] }, { _lintSourceOverride: async () => ({ messages: [] }) });
    let timerRanAt = null;
    let scanDoneAt = null;
    const timer = new Promise((resolve) => setTimeout(() => { timerRanAt = performance.now(); resolve(); }, 0));
    const scan = lint("filler line\n".repeat(50_000)).then(() => { scanDoneAt = performance.now(); });
    await Promise.all([timer, scan]);
    expect(timerRanAt).toBeLessThan(scanDoneAt);
  });

  it("reports an incomplete scan, keeping findings from the slices that completed", async () => {
    let calls = 0;
    const lint = createCompositeLinter({ rules: [] }, {
      ...SLICE,
      disableHighEntropy: true,
      _lintSourceOverride: async ({ source }) => {
        calls += 1;
        if (calls === 2) throw new Error("boom");
        return { messages: calls === 1 ? [{ ruleId: "r", range: [0, 3], messageId: "m" }] : [] };
      },
    });
    const messages = await lint("secret line\n".repeat(300));
    expect(messages.incomplete).toBe(true);
    expect(messages).toHaveLength(1);
  });
});
