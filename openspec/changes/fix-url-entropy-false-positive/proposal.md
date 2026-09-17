## Why

The high-entropy scanner's candidate-run tokenizer (`CANDIDATE_RUN_PATTERN`
in `src/entropy-rule.js`) includes `/` in its charset because `/` is a
legitimate standard-base64 character. But `/` is also the URL path
separator, and nothing in the tokenizer distinguishes the two. As a
result, an ordinary multi-segment URL path — e.g. a GitHub link like
`https://raw.githubusercontent.com/org/repo/<commit>/README.md` — gets
tokenized as one single glued-together "base64" run spanning the entire
path, which trivially exceeds the base64 entropy threshold and gets
redacted even though it contains no secret at all. This produces frequent,
disruptive false-positive redactions on plain URLs in tool output and chat
messages.

## What Changes

- Add a URL-span pre-pass to `src/entropy-rule.js` (same shape as the
  existing JWT-span pre-pass) that detects `scheme://…` spans in scanned
  text.
- When a base64/hex candidate run overlaps a detected URL span and
  contains `/`, split that run back into its `/`-delimited segments and
  entropy-score each segment independently, instead of scoring the whole
  glued blob as one run.
- Runs outside any URL span, and runs inside a URL span that contain no
  `/`, are unaffected — existing detection behavior (hex/UUID/SRI
  allowlists, JWT pre-pass, short-password path, thresholds) is unchanged.

**Explicitly out of scope:** query-string parameter values that
independently look secret-shaped (e.g. an OAuth `state=` nonce or
`client_id=` value) are not exempted by this change — they are correctly
tokenized as separate candidates already (`?`, `&` break runs), and
flagging a token-shaped query value is existing, intended behavior, not
the bug this change addresses.

## Capabilities

### Modified Capabilities
- `high-entropy-secret-detection`: adds a URL-path-aware tokenization rule
  so a URL path's `/` separators are never treated as base64/hex
  charset-continuation characters, preventing an entire multi-segment URL
  path from being scored as a single high-entropy candidate.

## Impact

- `src/entropy-rule.js`: new `findUrlSpans` function and a tokenization
  change in `findCandidateRuns`. No new dependencies, no public API
  surface change (the module's exports gain one new named export for
  testability, consistent with the existing pattern for `findJwtSpans`).
- No infrastructure, configuration, or cross-module changes.

**Accepted limitation:** the split only applies to a run that falls
*entirely* within a detected URL span. A run that begins before the span
and merges into it (e.g. a base64-looking blob glued directly, with no
whitespace or quote, onto a `scheme://…` URL) is left unsplit — the
scanner's existing pre-fix behavior for that composite run. This is
practically unreachable in the chat/tool-output text this scanner
targets, since a URL is virtually always preceded by whitespace or a
quote there, which already ends the run before the scheme begins. Covered
by an explicit regression test rather than left silently unhandled.
