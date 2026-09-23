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

// Verified fixtures for the short/password-shaped detection path (see the
// add-short-password-secret-detection change's design.md). Each fixture's
// exact Shannon entropy is documented and hand-verified; see that
// design.md for the full derivation. Kept separate from ENTROPY_FIXTURES
// (which covers only the pre-existing 23+/9+ character path) so each
// fixture list documents exactly which detection path it exercises.
export const SHORT_PASSWORD_FIXTURES = [
  {
    name: "P1: 14 chars at the floor, log2(14) ~= 3.8073549221",
    content: "aB3!cD7#eF2$gH",
    expectFinding: true,
  },
  {
    name: "P2: 22 chars at the ceiling, log2(22) ~= 4.4594316186",
    content: "aB1!cD2#eF3$gH4%iJ5^kL",
    expectFinding: true,
  },
  {
    name: "P3: 20 chars, no symbols (symbols are optional), r=2 repeats, H = log2(20) - 2*2/20 ~= 4.1219280949",
    content: "aB1mcD3NeF5mgH7NiJkL",
    expectFinding: true,
  },
  {
    name: "N1: 13 chars, below the floor, log2(13) ~= 3.7004397181",
    content: "aB3!cD7#eF2$g",
    expectFinding: false,
  },
  {
    name: "N2: 16 chars, entropy exactly 3.75 (pins > not >=)",
    content: "aBc3!DeF7#gH2$aB",
    expectFinding: false,
  },
  {
    name: "N3: 16 chars, repeated 4-char pattern, log2(4) = 2.0 (proves it was scored, not length-skipped)",
    content: "Ab1!".repeat(4),
    expectFinding: false,
  },
  {
    name: "N4a: 16 chars, all-lowercase-letters (no uppercase), log2(16) = 4.0 -- missing case mix",
    content: "a1!b2#c3$d4%e5^f",
    expectFinding: false,
  },
  {
    name: "N4b: identical length/entropy to N4a, mixed case -- case mix is the only discriminator",
    content: "A1!b2#c3$d4%e5^f",
    expectFinding: true,
  },
  {
    name: "N5: 22 chars, same multiset as P2 reordered into a 4+ same-class run -- run cap is the only discriminator",
    content: "acegikBDFHJL12345!#$%^",
    expectFinding: false,
  },
  {
    name: "N6: real dependency-derived identifier, rejected by the entropy threshold alone (regression guard)",
    content: "getFileUrlFromFullPath",
    expectFinding: false,
  },
  {
    name: "N7: real dependency-derived identifier, rejected by the class-run cap alone despite H=4.0 (regression guard)",
    content: "rightHandSymbols",
    expectFinding: false,
  },
  {
    name: "N9: real base64 fixture under threshold",
    content: "aGVsbG8gd29ybGQ",
    expectFinding: false,
  },
];

// Verified fixtures for the filesystem-path-span detection path (see the
// fix-filesystem-path-entropy-false-positive change's design.md). All
// eight are plain paths (no embedded secret), so they are safe to write
// as literals here per that design's test plan.
export const PATH_FIXTURES = [
  {
    name: "F1: proposal's reproduction literal (backtick-wrapped .worktrees/.venv path) -- measured H = 4.2398, a near miss below today's 4.5 threshold; a span-detection/documentation fixture, not a regression guard",
    content: "`/home/user/.worktrees/PLT-885-slack-mention-dm-user-id/.venv`",
    expectFinding: false,
  },
  {
    name: "F2: POSIX absolute path -- glued run (41 chars) has H = 4.571 and reproduces the false positive; every individual '/'-segment is <=7 chars, well under every detection path's floor (base64 23, hex 9, short-password 14), so the fix reports nothing",
    content: "/home/user/xK7bQ2z/mR9wQ3f/vN6sL1y/output",  // pragma: allowlist secret
    expectFinding: false,
  },
  {
    name: "F3: Windows drive-letter forward-slash absolute path -- glued run (37 chars, after the drive-letter prefix) has H = 4.625 and reproduces the false positive; every segment is <=7 chars",
    content: "C:/Data/xK7bQ2z/mR9wQ3f/vN6sL1y/x86_Rel",
    expectFinding: false,
  },
  {
    name: "F4: relative '../' path -- glued run (35 chars) has H = 4.569 and reproduces the false positive; every segment is <=7 chars",
    content: "../builds/xK7bQ2z/mR9wQ3f/vN6sL1y/out",
    expectFinding: false,
  },
  {
    name: "F5: relative '~/' path -- glued run (38 chars) has H = 4.732 and reproduces the false positive; every segment is <=8 chars",
    content: "~/projects/xK7bQ2z/mR9wQ3f/vN6sL1y/data",
    expectFinding: false,
  },
  {
    name: "F6: relative './' path -- glued run (40 chars) has H = 4.682 and reproduces the false positive; every segment is <=8 chars",
    content: "./builds/xK7bQ2z/mR9wQ3f/vN6sL1y/artifact",
    expectFinding: false,
  },
  {
    name: "F7: real-world framing -- backtick-quoted path embedded mid-sentence in tool output; span must start after the backtick",
    content: "warning: `/home/user/xK7bQ2z/mR9wQ3f/vN6sL1y/output` was ignored",
    expectFinding: false,
  },
  {
    name: "F8: native Windows backslash path -- asserts the no-change claim (backslash was never in the candidate charset, so this already tokenizes into short segments below the 23-char floor)",
    content: "C:\\Users\\jdoe\\AppData\\Local\\Temp\\BuildOutput-2024Q3\\x86_Rel",
    expectFinding: false,
  },
];
