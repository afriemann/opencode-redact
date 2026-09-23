# Proposal

## Why

`expandToTokenBoundaries` (`src/redact.js`) expands a redaction range outward
until it hits whitespace. Compact/minified JSON — e.g. `gh search code
--json ...`'s default output — has no internal whitespace between array
elements, only structural delimiters (`,` `:` `{` `}` `[` `]` `"`). When a
single finding lands anywhere inside such a blob, expansion currently walks
all the way to the blob's outer edges, replacing the entire tool output with
one placeholder instead of just the offending value. This is already a
documented, accepted trade-off ("Over-redaction is possible on dense,
single-line content" in README's Known Limitations), but the blast radius is
avoidably large.

**Verified safety invariant** (per security review of this proposal — see
disposition notes below): the actual reason none of this plugin's own
entropy-based candidate charsets (base64, base64url, hex, the short
password-shaped charset) can ever contain `" ' \` , { } [ ]` is structural —
their own tokenization patterns (`CANDIDATE_RUN_PATTERN`,
`PASSWORD_CANDIDATE_PATTERN`) exclude those characters before scoring even
starts, so a secret shaped for those detectors physically cannot contain
one. For the vendor-pattern (secretlint recommend-preset) rules, the
invariant is narrower and version-dependent: it holds not because no vendor
secret format could ever contain these 8 characters (the audited
`database-connection-string` rule's password capture group, `[^@\/\s]{1,200}`,
technically permits all 8), but because every reachable rule's own regex
match already reports a range that terminates at, or beyond, the true secret
boundary — `expandToTokenBoundaries` only ever grows a range outward, so it
never needs to reach past a boundary the rule itself already included. This
invariant depends on the installed `secretlint`/`@secretlint/secretlint-rule-preset-recommend`
version's rule implementations continuing to report complete ranges; it
should be re-verified on any bump of that dependency (see Impact).

## What Changes

- `expandToTokenBoundaries` stops expansion at whitespace **or** one of
  `" ' \` , { } [ ]` — whichever boundary is nearer — instead of whitespace
  only.
- `:` `;` `(` `)` `<` `>` `|` `&` `=` `?` `/` are deliberately **not** added
  to the boundary set: several can legitimately appear inside a URL,
  database connection string, or password value, so including them risks
  truncating part of a real secret. This change only ever narrows the
  redacted range compared to today; it can never leave a secret fragment
  unredacted that today's whitespace-only rule would have covered.
- README's "Over-redaction is possible on dense, single-line content" known
  limitation is updated to describe the narrowed (not eliminated) blast
  radius.

Not in scope: the GitHub GraphQL Node ID entropy false-positive that
originally surfaced this issue (a separate, unrelated false-positive in the
high-entropy detector — explicitly deferred by the user); any change to
`findCandidateRuns`, `findUrlSpans`, or any detection-rule logic; any new
boundary character beyond the eight listed above.

## Capabilities

### Modified Capabilities

- `tool-output-redaction`: the "Expand Redaction To Token Boundaries"
  requirement's boundary definition changes from "nearest surrounding
  whitespace" to "nearest surrounding whitespace or structural delimiter
  (`" ' \` , { } [ ]`)".

## Impact

- **Code**: `src/redact.js` (`expandToTokenBoundaries` only — no signature
  change, no new exports).
- **Tests**: `test/redact.test.js` — new cases for the structural-delimiter
  boundary; existing whitespace-boundary cases must still pass unchanged.
- **Specs**: `openspec/specs/tool-output-redaction/spec.md` — one requirement
  MODIFIED, one scenario added.
- **Docs**: `README.md` known-limitations note.
- **No API, schema, dependency, or configuration change.** `design.md` is
  skipped for this change: it is a single-function bug fix with no new
  architectural decision, no API/data-model/component-boundary change, no
  infrastructure/configuration change, and no new dependency (all four
  `design.md`-skip criteria hold).
- **Dependency-bump follow-up**: a code comment in `expandToTokenBoundaries`
  will document the verified-invariant dependency on secretlint rules
  reporting complete ranges, so a future `secretlint`/preset-recommend
  version bump re-triggers scrutiny of this assumption (per security
  review — see proposal review disposition).
