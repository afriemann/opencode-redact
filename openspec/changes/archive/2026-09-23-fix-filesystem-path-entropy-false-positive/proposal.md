# Proposal

## Why

The high-entropy detection rule flags ordinary filesystem paths as
candidate secrets. A path such as
`` `/home/user/git/some-repo/.worktrees/PLT-885-slack-mention-dm-user-id/.venv` ``
is not split on its `/` separators the way an already-fixed URL path is,
because `findUrlSpans` only recognizes a `scheme://` prefix. A `/`-glued
path segment (e.g. a branch or worktree directory name) can trivially
exceed the base64 entropy threshold on character diversity alone, with no
secret present, and gets redacted as `***REDACTED:high-entropy***` —
corrupting legitimate tool output. This was observed live in a `ruff`
warning naming a `.venv` path; the illustrative string above is a
sanitized approximation of that report and measures just under today's
threshold on its own (H = 4.2398 vs. 4.5) — the observed real path was
almost certainly slightly longer or more character-diverse. The
underlying bug class is verified and reproduces readily on several
slightly more diverse real-shaped paths (documented in `design.md`'s
Context section), which serve as the actual regression guards; the
quoted literal above is retained as a span-detection/documentation
fixture rather than the regression guard. This is the same class of
false positive already fixed for URLs in the archived
`fix-url-entropy-false-positive` change, recurring for filesystem paths
because that change's fix was scoped to `scheme://` spans only.

## What Changes

- Add detection of path-shaped spans in scanned text, anchored on a `/`
  at one of:
  - a whitespace/quote/backtick/bracket/start-of-string boundary
    (POSIX absolute, e.g. `/home/...`, `` `/home/...` ``);
  - immediately after a single drive letter and `:`, itself at such a
    boundary (Windows forward-slash absolute, e.g. `C:/Users/...`);
  - immediately after a `.`, `..`, or `~` prefix, itself at such a
    boundary (relative, e.g. `./foo/bar`, `../foo/bar`, `~/foo/bar`).
  The span's body charset includes `.` (and every other non-terminator
  character) so it spans the full path text, not just its own
  base64/hex-charset candidate-run fragments — this is what lets the
  span correctly cover a path like
  `` `/home/user/.worktrees/PLT-885-slack-mention-dm-user-id/.venv` ``,
  whose `.`-separated fragments are otherwise tokenized as several
  distinct candidate runs by `findCandidateRuns`, only the first of
  which begins with the anchoring `/`.
- To bound the new false-negative surface this introduces (a `/`-shaped
  boundary is a much weaker, more common anchor than the URL fix's
  `scheme://`), a detected span is discarded — treated as an ordinary
  run, not path-split — when its body contains `+` or `=` (essentially
  never present in a real path, common in standard base64) or when it
  contains fewer than 2 `/` characters in total (a single slash is as
  likely a base64 fragment as a path).
- Generalize the existing URL-span boundary logic in `findCandidateRuns`
  so a candidate run's `/` is treated as a segment boundary — never a
  base64/hex charset-continuation character — when that run falls within
  *either* a detected URL span or a detected (and not discarded) path
  span, splitting the run into its `/`-delimited segments exactly as the
  existing URL fix already does.
- No change to native Windows backslash paths (`C:\Users\...`) — `\` was
  never part of the candidate charset, so these already tokenize
  correctly without modification.
- Explicitly out of scope: bare relative-looking strings with no `/`,
  `./`, `../`, or `~/` anchor at all (e.g. a git ref like
  `origin/branch-name` or `refs/heads/feature/x`). These are
  indistinguishable from an ordinary `namespace/name`-shaped secret
  without a much weaker anchor than the ones above, and were explicitly
  declined during scoping in favor of keeping the anchor set bounded to
  affixes that are structurally unambiguous.

## Capabilities

### Modified Capabilities
- `high-entropy-secret-detection`: the existing "Treat URL Path
  Separators As Candidate-Run Boundaries" requirement is MODIFIED (full
  body restated, not appended) to generalize from "detected URL span" to
  "detected URL span or path span", since its existing "Does not affect a
  base64/hex run outside any URL span" scenario would otherwise be
  contradicted by a run that is now also affected via a path span. New
  scenarios cover POSIX/Windows/relative path anchors, the `.`-inclusive
  span body, and the `+`/`=`/slash-count discard guards.

## Impact

- `src/entropy-rule.js`: new `findPathSpans`/`PATH_SPAN_PATTERN` export,
  and a small generalization of `findCandidateRuns`'s span-merge logic to
  accept both URL spans and (non-discarded) path spans.
- `test/entropy-rule.test.js` / `test/entropy-fixtures.js`: new fixtures
  and unit tests for POSIX/Windows/relative path false positives
  (including the exact reproduced `ruff`/`.venv` string), a regression
  guard that a genuinely high-entropy segment inside a path is still
  flagged, and a false-negative guard that a quoted standard-base64
  secret beginning with `/` or containing internal `/` is still reported
  (proving the discard guards work).
- No new dependencies, no configuration changes, no API surface change to
  the rule's public `findHighEntropyFindings`/`creator` exports.

## Alternatives Considered

- **Remove `/` from the candidate charset entirely** (always a run
  boundary, drop `findUrlSpans`/`URL_SPAN_PATTERN` and the span-merge
  branch outright). Rejected: a materially larger change than this fix's
  approved scope, touching already-passing URL-path behavior and its
  existing tests for no incremental benefit over the anchored approach,
  and trading a bounded false-negative surface (anchored spans only) for
  an unbounded one (every `/`-containing run, everywhere).
- **Score every `/`-segment of a run in addition to the whole run, with
  no span/anchor concept at all.** Rejected: changes the scoring
  semantics of the existing base64/hex path more invasively than the
  established span-detection convention this codebase already uses for
  URLs; keeping the same convention for paths is more consistent and
  more narrowly scoped.
