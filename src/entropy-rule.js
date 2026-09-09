// Shannon-entropy-based detection of secret-shaped substrings that no
// vendor-pattern rule can catch. Implemented as a real secretlint rule
// module (SecretLintRuleCreator), registered directly into a composed
// config by src/secretlint.js rather than resolved from an npm package.
// See design.md D3-D6 for the full derivation and rationale behind every
// constant and decision below — this file follows that design closely and
// should not be re-derived from first principles without re-reading it.

// D3: candidates are maximal runs of the union of the standard-base64,
// base64url, and hex alphabets, plus padding. Maximal runs are pairwise
// disjoint by construction.
const CANDIDATE_RUN_PATTERN = /[A-Za-z0-9+/=_-]+/g;

const HEX_CLASS_PATTERN = /^[0-9a-fA-F]+$/;
const BASE64_CLASS_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

// D4: thresholds are detect-secrets' published defaults.
const HEX_THRESHOLD = 3.0;
const BASE64_THRESHOLD = 4.5;

// D4: length floor derived from the threshold (H <= log2(L), so H > T
// requires L > 2^T), never hard-coded separately, so the two can never
// drift apart.
const HEX_MIN_LENGTH = Math.floor(2 ** HEX_THRESHOLD) + 1; // 9
const BASE64_MIN_LENGTH = Math.floor(2 ** BASE64_THRESHOLD) + 1; // 23

/**
 * Shannon entropy (bits per character) over `text`'s own empirical
 * character distribution: H = -Sum (n_i/L) * log2(n_i/L) over the
 * distinct characters of the run. Order-independent — a permutation of
 * the same multiset of characters always yields the same value.
 */
export function shannonEntropy(text) {
  if (text.length === 0) {
    return 0;
  }
  const counts = new Map();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  const length = text.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

/**
 * Returns every maximal run of the candidate charset in `text`, in source
 * order, as `{ start, end, text }`. Disjoint by construction.
 */
export function findCandidateRuns(text) {
  const runs = [];
  for (const match of text.matchAll(CANDIDATE_RUN_PATTERN)) {
    runs.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return runs;
}

/**
 * Classifies a run's character set, most-specific-first (every hex run is
 * also a subset of the base64 alphabet, so hex must be checked first or
 * its threshold is unreachable). Returns `null` for a run outside both
 * alphabets — unreachable given `findCandidateRuns`' own tokenization, but
 * kept as a defensive branch.
 */
export function classifyRun(run) {
  if (HEX_CLASS_PATTERN.test(run)) {
    return { charset: "hex", threshold: HEX_THRESHOLD, minLength: HEX_MIN_LENGTH };
  }
  if (BASE64_CLASS_PATTERN.test(run)) {
    return { charset: "base64", threshold: BASE64_THRESHOLD, minLength: BASE64_MIN_LENGTH };
  }
  return null;
}

// D5: every allowlist predicate is fully anchored to the entire run so a
// run merely *containing* an exempt shape (e.g. a UUID prefix glued to a
// real secret) is never exempted.
//
// Shape #1 is case-uniform only: entirely lowercase or entirely uppercase
// hex, at the lengths git actually renders (7-12, abbreviated; 40, full)
// plus common digest lengths (32/40/64/128). A mixed-case run at one of
// these lengths is not a rendered git id or digest — every common tool
// renders hex in one case — so it is deliberately left scored normally.
const GIT_OR_DIGEST_HEX_PATTERN =
  /^(?:[0-9a-f]{7,12}|[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128}|[0-9A-F]{7,12}|[0-9A-F]{32}|[0-9A-F]{40}|[0-9A-F]{64}|[0-9A-F]{128})$/;
// Shape #2: UUID. Case-insensitive — the dash structure is already
// specific enough that a credential is not plausibly UUID-shaped by
// accident.
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Shape #3: Subresource Integrity / lockfile `integrity` digest
// (`sha256-<base64>`). Only the prefixed form is exempt — a bare padded
// base64 digest is indistinguishable from a base64-encoded API secret and
// is deliberately NOT exempted.
const SRI_PATTERN = /^sha(?:1|256|384|512)-[A-Za-z0-9+/_-]+={0,2}$/;

/**
 * Returns true when `run` matches one of the anchored allowlist shapes
 * (case-uniform git object id / hash digest, UUID, or SRI hash) and
 * should never be reported, regardless of its measured entropy.
 */
export function isAllowlistedRun(run) {
  return GIT_OR_DIGEST_HEX_PATTERN.test(run) || UUID_PATTERN.test(run) || SRI_PATTERN.test(run);
}

// D5 #4: a JWT cannot be matched as a single candidate run (`.` is not in
// the run charset), so it is detected via a separate pre-pass over the
// raw content. The `d` (hasIndices) flag exposes each match's absolute
// character offsets via `match.indices`, including the named `sig` group.
const JWT_SPAN_PATTERN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.(?<sig>[A-Za-z0-9_-]*)/dg;

/**
 * Finds every JWT-shaped span (three period-separated base64url segments,
 * header beginning `eyJ`) in `text`. For each span, returns
 * `{ start, end, signatureRange }` where `signatureRange` is the absolute
 * `{ start, end }` of the signature (third) segment, or `null` when that
 * segment is empty (an unsigned, `alg: none`-style token).
 */
export function findJwtSpans(text) {
  const spans = [];
  for (const match of text.matchAll(JWT_SPAN_PATTERN)) {
    const [fullStart, fullEnd] = match.indices[0];
    const [sigStart, sigEnd] = match.indices.groups.sig;
    const signatureRange = sigEnd > sigStart ? { start: sigStart, end: sigEnd } : null;
    spans.push({ start: fullStart, end: fullEnd, signatureRange });
  }
  return spans;
}

function isWithinAnySpan(run, spans) {
  return spans.some((span) => run.start >= span.start && run.end <= span.end);
}

/**
 * Orchestrates the full per-message detection pass: the JWT pre-pass
 * (reporting only non-empty signature segments, unconditionally), then
 * generic entropy scoring of every candidate run not inside a JWT span and
 * not allowlist-exempt. Returns findings in source order as
 * `{ start, end }` — no ruleId or message; the caller (the rule module
 * below) attaches those.
 */
export function findHighEntropyFindings(text) {
  const jwtSpans = findJwtSpans(text);
  const findings = [];

  for (const span of jwtSpans) {
    if (span.signatureRange) {
      findings.push({ start: span.signatureRange.start, end: span.signatureRange.end });
    }
  }

  for (const run of findCandidateRuns(text)) {
    if (isWithinAnySpan(run, jwtSpans)) {
      continue;
    }
    if (isAllowlistedRun(run.text)) {
      continue;
    }
    const classification = classifyRun(run.text);
    if (!classification || run.text.length < classification.minLength) {
      continue;
    }
    if (shannonEntropy(run.text) > classification.threshold) {
      findings.push({ start: run.start, end: run.end });
    }
  }

  findings.sort((a, b) => a.start - b.start);
  return findings;
}

// D6: the message is a constant with no interpolated props. It never
// contains the matched token, and passing no second argument to the
// translator keeps `data` as `undefined` — sidestepping a real engine
// trap where `maskSecrets` string-replaces every string value throughout
// the message, which would silently corrupt a prop as innocuous as
// `CHARSET: "base64"`.
const MESSAGES = {
  HighEntropySecret: {
    en: () => "found a high-entropy string that may be a secret",
  },
};

/**
 * The secretlint rule module. Registered directly by src/secretlint.js
 * into a composed config (not resolved from an npm package) with config
 * entry `id: "high-entropy"` — that id, not `meta.id`, is what secretlint
 * core attaches as `message.ruleId`, so `shortRuleId` (which only strips
 * an `@secretlint/secretlint-rule-` prefix) passes it through untouched:
 * `***REDACTED:high-entropy***`, or `***REDACTED:aws+high-entropy***` when
 * merged with an anchored-rule finding.
 */
export const creator = {
  messages: MESSAGES,
  meta: {
    id: "high-entropy",
    type: "scanner",
    recommended: false,
    supportedContentTypes: ["text"],
  },
  create(context) {
    const t = context.createTranslator(MESSAGES);
    return {
      file(source) {
        for (const finding of findHighEntropyFindings(source.content)) {
          context.report({
            message: t("HighEntropySecret"),
            range: [finding.start, finding.end],
          });
        }
      },
    };
  },
};
