// Verified high-entropy fixtures for the entropy-detection rule (see
// design.md D9). Unlike RULE_FIXTURES (one entry per vendor-pattern rule,
// verified by probing the real rule bundle), there is no vendor to verify
// an entropy rule against. Instead, each fixture is constructed so its
// Shannon entropy is exact and hand-checkable: a uniform multiset of `k`
// distinct symbols has H = log2(k) regardless of character order, so the
// characters can be scrambled to look like a credential without changing
// the value.
//
// Deliberately kept separate from RULE_FIXTURES: that array is consumed by
// the `looksLikeSecret` prescreen-positive assertion and by test/corpus.js
// (which feeds the frozen refactor-safety baseline) — an anchor-free
// fixture would break both.

export const ENTROPY_FIXTURES = [
  {
    name: "base64 positive (36 distinct symbols, log2(36) ~= 5.169925001)",
    content: "0123456789abcdefghijklmnopqrstuvwxyz",
    expectFinding: true,
  },
  {
    name: "base64 arithmetic pin (26 distinct symbols, log2(26) ~= 4.700439718)",
    content: "abcdefghijklmnopqrstuvwxyz",
    expectFinding: true,
  },
  {
    name: "hex positive (16 distinct symbols x3, log2(16) = 4.0)",
    content: "0123456789abcdef".repeat(3),
    expectFinding: true,
  },
  {
    name: "base64 negative, scored but under threshold (16 distinct symbols x2, log2(16) = 4.0 <= 4.5)",
    content: "ghijklmnopqrstuv".repeat(2),
    expectFinding: false,
  },
  {
    name: "hex negative, scored but under threshold (4 distinct symbols x11, log2(4) = 2.0)",
    content: "0123".repeat(11),
    expectFinding: false,
  },
  {
    name: "hex boundary, exactly the threshold (8 distinct symbols x6, log2(8) = 3.0 exactly)",
    content: "01234567".repeat(6),
    expectFinding: false,
  },
  {
    name: "allowlisted git SHA despite H > threshold (SHA-1 of the empty input, H ~= 3.7373)",
    content: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    expectFinding: false,
  },
  {
    name: "case-uniformity pair (a): all-lowercase 32-char hex, log2(16) = 4.0 -- exempt",
    content: "0123456789abcdef0123456789abcdef".slice(0, 32),
    expectFinding: false,
  },
  {
    name: "case-uniformity pair (b): identical length/entropy, mixed case -- not exempt",
    content: "0123456789ABCdef0123456789abcdef".slice(0, 32),
    expectFinding: true,
  },
  {
    name: "signed JWT: exactly one finding, matching only the signature segment",
    content:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.aaaaaaaaaaaaaaaaaaaaaaaa",
    expectFinding: true,
  },
  {
    name: "unsigned JWT (alg: none): no finding at all",
    content: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.",
    expectFinding: false,
  },
  {
    name: "allowlisted UUID",
    content: "550e8400-e29b-41d4-a716-446655440000",
    expectFinding: false,
  },
  {
    name: "allowlisted Subresource Integrity hash",
    content: "sha512-2eDaqheYQiOtbY2wR2Ck2AiwPRXJhrZ0Nc/l5MMjhqZ1PbNr2gDkG9pW+GYA/JzOTkyCcz4LgN",
    expectFinding: false,
  },
];
