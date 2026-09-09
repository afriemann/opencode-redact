// spec: openspec/specs/high-entropy-secret-detection/spec.md
//
// Tests for the pure entropy-detection helpers and the secretlint rule
// module they back. Fixture values mirror design.md D9 exactly: every
// fixture is a uniform-multiset construction with an exact, hand-checkable
// Shannon entropy (order-independent, so characters are scrambled to look
// like credentials without changing the value).

import { describe, it, expect } from "vitest";
import {
  shannonEntropy,
  findCandidateRuns,
  classifyRun,
  isAllowlistedRun,
  findJwtSpans,
  findHighEntropyFindings,
  creator,
} from "../src/entropy-rule.js";
import { ENTROPY_FIXTURES } from "./entropy-fixtures.js";

const LOG2_36 = Math.log2(36); // 5.169925001442312
const LOG2_26 = Math.log2(26); // 4.700439718141092
const LOG2_16 = Math.log2(16); // 4.0
const LOG2_4 = Math.log2(4); // 2.0
const LOG2_8 = Math.log2(8); // 3.0

describe("shannonEntropy", () => {
  it("is 0 for an empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("is 0 for a string of one repeated character", () => {
    expect(shannonEntropy("aaaaaaaaaa")).toBe(0);
  });

  it("computes log2(36) for 36 distinct base64-alphabet symbols, each occurring once", () => {
    const distinct = "0123456789abcdefghijklmnopqrstuvwxyz"; // 10 + 26 = 36 distinct chars
    expect(distinct).toHaveLength(36);
    expect(shannonEntropy(distinct)).toBeCloseTo(LOG2_36, 9);
  });

  it("computes log2(26) for the 26 lowercase letters, each occurring once", () => {
    const distinct = "abcdefghijklmnopqrstuvwxyz";
    expect(shannonEntropy(distinct)).toBeCloseTo(LOG2_26, 9);
  });

  it("computes log2(16) for three repetitions of 16 distinct hex symbols", () => {
    const text = "0123456789abcdef".repeat(3);
    expect(shannonEntropy(text)).toBeCloseTo(LOG2_16, 9);
  });

  it("computes log2(4) for a repeated 4-symbol pattern", () => {
    const text = "0123".repeat(11);
    expect(shannonEntropy(text)).toBeCloseTo(LOG2_4, 9);
  });

  it("computes log2(8) exactly for a repeated 8-symbol pattern (the hex boundary fixture)", () => {
    const text = "01234567".repeat(6);
    expect(shannonEntropy(text)).toBeCloseTo(LOG2_8, 9);
  });
});

describe("findCandidateRuns", () => {
  it("finds a single run spanning the whole input when it is all one charset", () => {
    const text = "aGVsbG8gd29ybGQ";
    expect(findCandidateRuns(text)).toEqual([{ start: 0, end: text.length, text }]);
  });

  it("splits on characters outside the run charset", () => {
    const text = '{"apiKey":"a8Fk9Zx"}';
    const runs = findCandidateRuns(text);
    expect(runs.map((r) => r.text)).toEqual(["apiKey", "a8Fk9Zx"]);
  });

  it("returns disjoint runs that never overlap", () => {
    const text = "foo.bar.baz qux-quux";
    const runs = findCandidateRuns(text);
    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i].start).toBeGreaterThanOrEqual(runs[i - 1].end);
    }
  });

  it("returns an empty array for text with no qualifying characters", () => {
    expect(findCandidateRuns("... :: {} !!")).toEqual([]);
  });
});

describe("classifyRun", () => {
  it("classifies an all-hex run as hex (hex-first ordering)", () => {
    expect(classifyRun("0123456789abcdef")).toEqual({ charset: "hex", threshold: 3.0, minLength: 9 });
  });

  it("classifies an all-uppercase-hex run as hex", () => {
    expect(classifyRun("0123456789ABCDEF")).toMatchObject({ charset: "hex" });
  });

  it("classifies a base64-shaped run containing a non-hex letter as base64", () => {
    expect(classifyRun("aGVsbG8gd29ybGQ")).toEqual({ charset: "base64", threshold: 4.5, minLength: 23 });
  });

  it("returns null for a run containing characters outside both alphabets", () => {
    expect(classifyRun("hello world!")).toBeNull();
  });
});

describe("isAllowlistedRun", () => {
  it("exempts a lowercase 7-character abbreviated git commit id", () => {
    expect(isAllowlistedRun("bab179f")).toBe(true);
  });

  it("exempts a lowercase 12-character abbreviated git commit id", () => {
    expect(isAllowlistedRun("bab179f39dd1")).toBe(true);
  });

  it("exempts an uppercase 40-character hash digest", () => {
    expect(isAllowlistedRun("DA39A3EE5E6B4B0D3255BFEF95601890AFD80709")).toBe(true);
  });

  it("exempts a lowercase 40-character hash digest (SHA-1 of the empty input)", () => {
    expect(isAllowlistedRun("da39a3ee5e6b4b0d3255bfef95601890afd80709")).toBe(true);
  });

  it("does not exempt a mixed-case 40-character hex run of the same length", () => {
    // identical characters to the exempt SHA-1 fixture but with a, b, c
    // upper-cased -- same length, same entropy, only case differs.
    const mixedCase = "dA39A3ee5e6b4b0d3255bfef95601890afd80709";
    expect(isAllowlistedRun(mixedCase)).toBe(false);
  });

  it("does not exempt a mixed-case 32-character hex run (case-uniformity pair)", () => {
    const uniform32 = "0123456789abcdef0123456789abcdef".slice(0, 32);
    expect(uniform32).toHaveLength(32);
    expect(isAllowlistedRun(uniform32)).toBe(true);
    const mixedCase32 = "0123456789ABCdef0123456789abcdef".slice(0, 32);
    expect(mixedCase32).toHaveLength(32);
    expect(isAllowlistedRun(mixedCase32)).toBe(false);
  });

  it("exempts a canonically-formatted UUID regardless of case", () => {
    expect(isAllowlistedRun("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isAllowlistedRun("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("does not exempt a run merely containing a UUID shape with extra trailing content", () => {
    expect(isAllowlistedRun("550e8400-e29b-41d4-a716-446655440000-REALSECRET")).toBe(false);
  });

  it("exempts a Subresource Integrity hash", () => {
    expect(isAllowlistedRun("sha512-2eDaqheYQiOtbY2wR2Ck2AiwPRXJhrZ0Nc/l5MMjhqZ1PbNr2gDkG9pW+GYA/JzOTkyCcz4LgN")).toBe(
      true,
    );
  });

  it("does not exempt a bare padded base64 digest with no SRI prefix", () => {
    expect(isAllowlistedRun("2eDaqheYQiOtbY2wR2Ck2AiwPRXJhrZ0Nc/l5MMjhqQ==")).toBe(false);
  });

  it("does not exempt an unrelated high-entropy run", () => {
    expect(isAllowlistedRun("0123456789abcdefghijklmnopqrstuvwxyz")).toBe(false);
  });
});

describe("findJwtSpans", () => {
  const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIn0";

  it("finds a signed JWT and reports the signature's exact range", () => {
    const signature = "aaaaaaaaaaaaaaaaaaaaaaaa"; // 24 chars
    const text = `${header}.${payload}.${signature}`;
    const spans = findJwtSpans(text);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span.start).toBe(0);
    expect(span.end).toBe(text.length);
    expect(span.signatureRange).toEqual({
      start: header.length + 1 + payload.length + 1,
      end: text.length,
    });
    expect(text.slice(span.signatureRange.start, span.signatureRange.end)).toBe(signature);
  });

  it("reports no signature range for an unsigned (alg: none) JWT", () => {
    const text = `${header}.${payload}.`;
    const spans = findJwtSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].signatureRange).toBeNull();
  });

  it("finds no JWT span in ordinary text or a bare three-part dotted string without the eyJ prefix", () => {
    expect(findJwtSpans("1.2.3")).toEqual([]);
    expect(findJwtSpans("just some ordinary prose.")).toEqual([]);
  });
});

describe("findHighEntropyFindings (integration of the pure helpers)", () => {
  it("reports the base64-positive fixture (36 distinct symbols)", () => {
    const fixture = "0123456789abcdefghijklmnopqrstuvwxyz";
    const text = `value: ${fixture} end`;
    const findings = findHighEntropyFindings(text);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(text.slice(finding.start, finding.end)).toBe(fixture);
  });

  it("does not report the hex boundary fixture (exactly 3.0 bits/char)", () => {
    const text = `value=${"01234567".repeat(6)} end`;
    expect(findHighEntropyFindings(text)).toEqual([]);
  });

  it("does not report the hex negative fixture (log2(4), scored but under threshold)", () => {
    const text = `value=${"0123".repeat(11)} end`;
    expect(findHighEntropyFindings(text)).toEqual([]);
  });

  it("does not report a below-floor-length base64 run even if it were hypothetically high-entropy", () => {
    const text = "value=abcdefghijklmnopqrstu end"; // 21 chars, below the 23-char floor
    expect(findHighEntropyFindings(text)).toEqual([]);
  });

  it("does not report an allowlisted git SHA despite its entropy exceeding the hex threshold", () => {
    const text = "commit da39a3ee5e6b4b0d3255bfef95601890afd80709 done";
    expect(findHighEntropyFindings(text)).toEqual([]);
  });

  it("reports exactly one finding for a signed JWT, matching only the signature range", () => {
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const signature = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const text = `Authorization: Bearer ${header}.${payload}.${signature}`;
    const findings = findHighEntropyFindings(text);
    expect(findings).toHaveLength(1);
    expect(text.slice(findings[0].start, findings[0].end)).toBe(signature);
  });

  it("reports nothing for an unsigned JWT (no fallback scoring of header/payload)", () => {
    const header = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0";
    const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const text = `${header}.${payload}.`;
    expect(findHighEntropyFindings(text)).toEqual([]);
  });
});

describe("ENTROPY_FIXTURES (D9 verified fixtures)", () => {
  it("matches expectFinding for every fixture via findHighEntropyFindings", () => {
    for (const fixture of ENTROPY_FIXTURES) {
      const findings = findHighEntropyFindings(fixture.content);
      expect(findings.length > 0, `fixture '${fixture.name}' expected finding=${fixture.expectFinding}`).toBe(
        fixture.expectFinding,
      );
    }
  });
});

describe("entropy rule module (secretlint rule creator shape)", () => {
  it("has the expected meta shape", () => {
    expect(creator.meta.type).toBe("scanner");
    expect(creator.meta.supportedContentTypes).toEqual(["text"]);
  });

  it("reports via context.report with a constant message and no interpolated data", () => {
    const reports = [];
    const fakeContext = {
      createTranslator: (messages) => (messageId) => ({
        message: messages[messageId].en(),
        messageId,
        data: undefined,
      }),
      report(descriptor) {
        reports.push(descriptor);
      },
    };
    const handler = creator.create(fakeContext, {});
    const fixture = "0123456789abcdefghijklmnopqrstuvwxyz";
    const content = `value: ${fixture}`;
    handler.file({ content, filePath: "/dev/null/x.txt", ext: ".txt", contentType: "text" });
    expect(reports).toHaveLength(1);
    expect(reports[0].message.data).toBeUndefined();
    expect(typeof reports[0].message.message).toBe("string");
    const [start, end] = reports[0].range;
    expect(content.slice(start, end)).toBe(fixture);
  });
});
