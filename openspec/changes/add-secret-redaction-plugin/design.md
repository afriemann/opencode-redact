## Context

See `proposal.md` for motivation and the confirmed v1 scope. This document covers
only *how* the plugin is built.

Constraints that shape the approach, all verified against the code installed in
this repo's `node_modules` (`@secretlint/*@13.0.5`) rather than assumed:

- **Findings are ranges, not values.** `lintSource` returns
  `messages: [{ ruleId, ruleParentId?, message, messageId, range, loc, severity }]`.
  Every rule in the recommend preset builds its range as
  `[index, index + match.length]` — a **half-open, end-exclusive** JS string index
  pair in UTF-16 code units, the same units `String.prototype.slice` uses. No
  offset conversion is needed.
- **Not every range covers its secret.** `@secretlint/secretlint-rule-aws`'s
  secret-access-key check reports `range = [result.index, result.index + result[1].length]`
  — the start of the *whole* match (the `SECRET_ACCESS_KEY=` label) combined with
  the length of *capture group 1* (the 40-char key). The reported window is
  therefore shifted left and covers the label plus only part of the key. Splicing
  that range verbatim leaves the tail of a live AWS secret in the output. This is
  the single most consequential finding behind the design below.
- **Some ranges cover the whole document.** `@secretlint/secretlint-rule-gcp`'s
  JSON check reports `range: [0, source.content.length]`.
- **One rule touches the filesystem.** The GCP p12 check calls
  `fs.readFileSync(source.filePath)` directly, bypassing the `noPhysicFilePath`
  guard (which only affects `context.getSourceFilePath()`). The virtual path we
  pass is a real read attempt.
- **Rule matching is synchronous.** Every rule body is a synchronous
  `String.prototype.matchAll` loop. This bounds what a wall-clock timeout can
  actually do (see D5).
- **The preset is a self-contained bundle.** `@secretlint/secretlint-rule-preset-recommend`
  ships a single rolled-up `module/index.js` with all 28 rules inlined and declares
  no runtime `dependencies`.
- **opencode loads the plugin through a symlink** and treats every top-level named
  function export of a scanned plugin file as an independent plugin factory (the
  recorded `opencode-use` constraint). The symlinked entry file must export nothing
  but `default`.

## Goals / Non-Goals

**Goals:**

- A redaction core that is a pure function of `(text, injected linter)` so the
  whole detection→merge→splice pipeline is unit-testable without invoking
  secretlint, and testable *with* secretlint through the same seam.
- Redaction that never leaves a partially-covered secret in the output, even when
  a rule reports an inaccurate range.
- A prescreen whose correctness property is *"never skips content the preset would
  flag"* — and which is guarded by a test, not by hand-derivation that rots on the
  next preset upgrade.
- A failure model with exactly one fail-loud point (startup) and fail-open
  everywhere else.

**Non-Goals (design-level, additional to the proposal's scope):**

- No configuration surface of any kind: no config file, no environment variable,
  no per-rule enable/disable, no allowlist. The recommend preset with
  `filter-comments` disabled is hard-coded.
- No caching of scan results across calls, no deduplication of repeated outputs.
- No worker thread, subprocess, or other isolation boundary around the linter.
- No attempt to make redaction reversible or to retain the original text anywhere.

## Decisions

### D1 — Module boundaries and function inventory

Three modules. The split exists to keep the symlinked entry file export-clean and
to give the redaction logic a test seam.

**`src/index.js`** — hook wiring. Exports `default` and nothing else.

```
export default async function OpencodeRedact({ client }) → { "tool.execute.after": handler }
```

The factory awaits `createSecretlintConfig()` and builds the bound linter once,
then closes over both. `handler(input, output)` reads `output.output`, and on a
non-empty string calls `redactSecrets`, assigns the result back to `output.output`
in place, and logs when `redactionCount > 0`. The handler wraps its own body in
`try/catch` and swallows everything (D5).

**`src/secretlint.js`** — the impure edge. Everything that touches secretlint.

```
createSecretlintConfig() → Promise<SecretLintCoreConfig>
createLinter(config, { timeoutMs }) → (text: string) => Promise<Message[]>
```

`createSecretlintConfig` calls `loadPackagesFromConfigDescriptor` once with the
descriptor fixed in the proposal (recommend preset, `filter-comments` disabled).
`createLinter` returns a closure that calls `lintSource` with the virtual source
(D6) and the timeout race (D5), and returns `result.messages`.

**`src/redact.js`** — the pure core. Named exports, no secretlint import.

```
looksLikeSecret(text: string) → boolean
normalizeRanges(text: string, messages: Message[]) → Interval[]
expandToTokenBoundaries(text: string, start: number, end: number) → [number, number]
mergeIntervals(intervals: Interval[]) → Interval[]
spliceRedactions(text: string, merged: Interval[]) → string
shortRuleId(ruleId: string) → string
buildAnnotation(count: number, ruleIds: string[]) → string
redactSecrets(text, { lint }) → Promise<{ text, redactionCount, ruleIds }>
```

`Interval` is `{ start: number, end: number, ruleIds: Set<string> }`.

`redactSecrets` is the orchestrator and takes the linter **by injection**:

1. Return `{ text, redactionCount: 0, ruleIds: [] }` unchanged if `text` is not a
   non-empty string, or if `looksLikeSecret(text)` is false.
2. `messages = await lint(text)`.
3. `intervals = normalizeRanges(text, messages)` (drops malformed ranges, applies
   `expandToTokenBoundaries` to each survivor).
4. `merged = mergeIntervals(intervals)`; if empty, return unchanged.
5. `redacted = spliceRedactions(text, merged)`.
6. Return `{ text: redacted + buildAnnotation(...), redactionCount: merged.length, ruleIds }`.

Because `lint` is a parameter, the entire test matrix in the proposal — multiple
findings, overlapping findings, scanner error, timeout, empty input — is exercised
with a stub `lint`, deterministically and with no I/O. A separate integration test
passes the real `createLinter(...)` through the same parameter.

**Rejected alternative:** putting the helpers in `src/index.js` and testing via the
hook. Rejected because the entry file must stay export-clean, and because testing
through the hook would force every case to fabricate an opencode `client`.

### D2 — Prescreen

**Shape.** One module-level `RegExp` built from a literal alternation plus one
structural sub-pattern, compiled with `i` and **without** `g`, evaluated with
`.test()` so it short-circuits at the first hit. No `toLowerCase()` copy of the
haystack — that would allocate a second full-size string on every tool call.
Case-insensitivity makes the prescreen strictly more permissive than the rules,
which are mostly case-sensitive.

**Correctness property.** The prescreen must never return `false` for content the
preset would flag. It is allowed — and expected — to return `true` far more often
than a secret is present. Every anchor below is a literal that the corresponding
rule's regex *requires*, so no rule can fire without at least one anchor matching.

**Correction found during implementation (2026-09-04):** empirically probing every
rule against the real installed `@secretlint/secretlint-rule-preset-recommend@13.0.5`
(not assumed from source reading alone) revealed that the AWS rule's access-key-id
and account-id checks are gated behind an `enableIDScanRule` option that **defaults
to `false`** — `reportAWSAccessKey` and `reportAWSAccountID` are only invoked when
`normalizedOptions.enableIDScanRule` is true; only `reportAWSSecretAccessKey` runs
unconditionally. Since D6 configures the preset with no rule-level options override,
these two checks never fire under this plugin's configuration. The `akia`/`asia`/etc.
and `account` anchors below are consequently anchors for detection paths that cannot
trigger — retained in the table for documentation accuracy (in case a future config
change enables them) but excluded from the per-rule conformance test's rule count,
which only enumerates the checks that are actually reachable through this plugin's
fixed configuration.

**Literal anchors, by originating rule:**

| Rule | Required literal(s) |
|---|---|
| aws (access key id) — **not reachable at default config, see correction above** | `akia` `asia` `agpa` `aida` `aroa` `aipa` `anpa` `anva` `a3t` |
| aws (secret access key) | `secret` |
| aws (account id) — **not reachable at default config, see correction above** | `account` |
| privatekey, gcp (JSON) | `-----begin` |
| github | `ghp_` `gho_` `ghu_` `ghs_` `ghr_` `github_pat_` `x-oauth-basic` |
| gitlab | `glpat-` |
| grafana | `glc_` `glsa_` |
| slack | `xoxb-` `xoxp-` `xapp-` `xoxa-` `xoxo-` `xoxr-` `hooks.slack.com` |
| openai | `t3blbkfj` |
| anthropic | `sk-ant-` |
| stripe | `sk_live` `sk_test` `rk_live` `rk_test` |
| groq | `gsk_` |
| huggingface | `hf_` |
| linear | `lin_api_` |
| notion | `ntn_` |
| sendgrid | `sg.` |
| shopify | `shppa_` `shpca_` `shpat_` `shpss_` |
| npm | `npm_` `_authtoken=` |
| 1password | `ops_` |
| hashicorp-vault | `hvs.` `hvb.` `hvr.` |
| vercel | `vcp_` `vci_` `vca_` `vcr_` `vck_` |
| databricks | `dapi` |
| docker | `dckr_pat_` |
| figma | `figd_` |
| cloudflare | `cfk_` `cfut_` `cfat_` |
| tailscale | `tskey-` |

**Structural anchor** for basicauth and database-connection-string, neither of
which has a literal token prefix. Both require a `scheme://user:pass@host` shape
and both `continue` when username or password is absent:

```
:\/\/[^\s\/@:]{1,256}:[^\s\/@]{1,256}@
```

The character classes are supersets of both rules' own username/password classes
(`[^:\/\s]`, `[^@\/\s]`, `[-a-zA-Z0-9_]`), so this cannot be narrower than what
the rules accept. Excluding `:` from the first class and `@` from the second makes
both split points deterministic, so there is no backtracking and the sub-pattern
is linear — it must not become the ReDoS vector it exists to help avoid.

**Three anchors deserve their rationale spelled out, because they look wrong:**

- **`secret` / `account` rather than `aws`.** The AWS rule's prefix constant is
  `"(?:AWS|aws|Aws)?_?"` — *optional*. A bare `SECRET_ACCESS_KEY=<40 chars>` with
  no "aws" anywhere is a finding. Anchoring on `aws` would be a real
  false-negative. The only mandatory literals are `SECRET`/`ACCESS`/`KEY` and
  `ACCOUNT`; the two shortest are used.
- **`t3blbkfj` rather than `sk-`.** Every OpenAI variant in the rule's pattern
  contains the fixed infix `T3BlbkFJ`. Anchoring on `sk-` instead would fire on
  `task-`, `risk-`, `disk-` and similar ordinary prose, making the prescreen
  near-useless on text-heavy output for no detection gain.
- **`-----begin` covers GCP.** The GCP service-account JSON check requires
  `PRIVATE_KEY_PATTERN.test(credentialObject["private_key"])`, so a GCP finding
  cannot occur without `-----BEGIN` in the content. No separate GCP anchor is
  needed.

**The list is not the authority; the conformance test is.** Hand-derivation from
a bundled preset is exactly the kind of knowledge that goes stale on the next
`npm update`. The suite therefore carries one known-positive fixture per preset
rule and asserts, for each, that `looksLikeSecret(fixture) === true` **and** that
the real linter reports a finding on it. A preset upgrade that adds a rule with a
new prefix fails that test rather than silently opening a hole.

**Rejected alternatives:** a size cutoff (excluded by the proposal); entropy
scoring (expensive, and false-negatives on low-entropy structured findings like
connection strings); skipping the prescreen entirely (pays the full 28-rule scan
on every tool call, including the overwhelming majority that are plainly clean).

### D3 — Range normalisation, merge, and splice

Three sequential passes over the findings, then one pass over the text.

**Pass 1 — normalise and expand.** For each message:

1. Reject the range unless `start` and `end` are integers with
   `0 <= start < end <= text.length`. A malformed range is dropped, not repaired,
   and does not fail the call.
2. Expand it with `expandToTokenBoundaries`: walk `start` left while the preceding
   character is not whitespace; walk `end` right while the character at `end` is
   not whitespace. Emit `{ start, end, ruleIds: new Set([ruleId]) }`.

Expansion is applied **uniformly**, not only to the rules known to report badly.
That is deliberate: a per-rule allowlist is a maintenance liability that a preset
upgrade can silently invalidate, whereas uniform expansion is correct by
construction. It converts the shifted AWS range into full coverage of the whole
`SECRET_ACCESS_KEY=<40 chars>` token, and is a no-op for the many rules whose
ranges are already exact except for adjacent quotes and punctuation, which it
absorbs harmlessly. Expansion is naturally line-bounded, since a newline is
whitespace and therefore always a stop character. It also cannot split a UTF-16
surrogate pair, because the stop characters are all BMP whitespace.

**Pass 2 — merge.** Sort by `start` ascending, then `end` descending. Sweep once,
carrying a current interval:

```
if (next.start <= cur.end)      // overlapping OR exactly touching
    cur.end = max(cur.end, next.end)
    cur.ruleIds ∪= next.ruleIds
else
    emit cur; cur = next
```

`<=` rather than `<` is intentional: after expansion two intervals can only touch
when they sit in the same unbroken non-whitespace run, in which case merging is
right and the alternative would emit `***REDACTED:a******REDACTED:b***`. The result
is a sorted, strictly disjoint, non-adjacent interval list — the precondition the
splice relies on.

**Pass 3 — splice.** Single left-to-right pass with a cursor, collecting into an
array and joining once:

```
cursor = 0; parts = []
for each { start, end, ruleIds } in merged:
    parts.push(text.slice(cursor, start), placeholderFor(ruleIds))
    cursor = end
parts.push(text.slice(cursor))
return parts.join("")
```

Because the intervals are sorted and disjoint, every `slice` is forward-only and
no index is invalidated by an earlier replacement — which is precisely the class of
bug that in-place `String.replace` per finding would introduce.

**The half-open convention must be pinned by a test, not by this document.** The
rule sources all construct `[index, index + match.length]`, so it is half-open;
but the test must assert the **exact** resulting string for a fixture whose secret
ends mid-line, not merely that the output contains `REDACTED`. An off-by-one in the
inclusive direction leaves exactly one trailing character of the secret in place —
a failure that a `contains` assertion would pass.

### D4 — Placeholder and annotation

**Placeholder.** `***REDACTED:<label>***`, where `<label>` is derived from the
merged interval's rule ids:

- `shortRuleId` strips the `@secretlint/secretlint-rule-` prefix, falling back to
  the raw id if the prefix is absent, so `@secretlint/secretlint-rule-aws` → `aws`.
- For a merged interval covering several rules, labels are deduplicated, sorted,
  and joined with `+`: `***REDACTED:aws+privatekey***`. Sorting keeps the output
  deterministic and therefore snapshot-testable.

The placeholder contains no prescreen anchor, so it cannot re-trigger a scan of
itself.

**Annotation.** Appended once, after all splicing, separated by a blank line. It is
appended after redaction and is therefore never itself scanned:

> `[opencode-redact] <n> secret(s) in this tool output were detected and replaced`
> `with ***REDACTED:...*** placeholders (rules: <labels>). A placeholder is NOT the`
> `real value and is NOT part of the underlying file, command output, or response.`
> `Never write, copy, echo, or commit a ***REDACTED:...*** placeholder into a file,`
> `command, or message — doing so would overwrite real content with this marker.`
> `If you need the redacted value, ask the user for it; do not try to recover it.`

The wording targets the specific failure the proposal identifies: a `read` whose
redacted output is later fed to a `write`/`edit`. It therefore names the concrete
prohibited action (writing the placeholder back) rather than issuing a general
caution, and states plainly that the placeholder is not real file content.

### D5 — Error, timeout, and failure flow

**One fail-loud point: startup.** `createSecretlintConfig()` is awaited inside the
plugin factory. A rejection is logged at `error` level and rethrown, so opencode's
loader reports a failed plugin rather than running the session silently
unprotected. This falls out of the factory being `async` — no lazy singleton, no
initialisation flag, no first-call retry.

**Everything after startup fails open.** Three nested guards, each returning the
original text unmodified:

1. `createLinter`'s closure wraps `lintSource` in `Promise.race` against a timer.
   A timeout rejects with a distinguishable error.
2. `redactSecrets` catches anything thrown by `lint` (including the timeout) and
   returns `{ text, redactionCount: 0, ruleIds: [] }` — the original string.
3. The hook handler wraps its whole body. Nothing propagates out of
   `tool.execute.after`, per the opencode hook contract.

Guard 3 is not redundant with guard 2: it also covers a fault in `spliceRedactions`
or in reading `output.output`, and it is the boundary the hook contract actually
requires.

**Fail-open applies only to scanner faults, never to a finding.** A successful lint
that returns messages always redacts; there is no path where a finding is
downgraded to a pass-through.

**The timeout is a partial guard, and the design says so rather than implying
otherwise.** Every rule matches synchronously. A pathological input that sends one
rule's regex into a long backtrack blocks the event loop, and the timer cannot fire
until that regex returns — so `Promise.race` bounds *await points inside* the lint,
not a synchronous regex hot loop. It still catches a rule that awaits (the GCP p12
path does dynamic `import()` and a filesystem read) and it bounds the cumulative
cost of a very large but well-behaved input. Real isolation would need a worker
thread or subprocess; that is rejected for v1 as disproportionate — per-call
serialisation overhead on every tool result, for a preset whose authors explicitly
document possessive/bounded quantifiers as ReDoS mitigation. The residual risk is
recorded below.

**Logging on redaction** carries the tool name, the finding count, and the short
rule labels only. Never the matched text, never the finding `message`, never the
original output. `maskSecrets: true` is set on `lintSource` as defence in depth so
that even `message` cannot carry the raw value if a future change logs it by
mistake. The exact `client.app.log` payload shape is taken from the installed
`@opencode-ai/plugin` types at implementation time.

### D6 — secretlint invocation and the virtual source

**Correction found during implementation (2026-09-04):** the GCP rule (both its
`.p12` and `.json` sub-checks) gates on `source.ext` directly —
`if (source.ext === ".p12") { ... } else if (source.ext === ".json") { ... }` —
and runs **neither** check for any other extension, including `.txt`. A fixed
`ext: ".txt"` virtual source therefore makes the GCP JSON detection dead code:
it would never fire in production regardless of what secret the tool output
contains. This was found empirically (probing the real installed rule, not
inferred from the source read during design), and changes the virtual source
from a single fixed descriptor to one with a **content-dependent `ext`**:

1. Attempt `JSON.parse(text)`. If it succeeds and the result is a non-null
   object, use `ext: ".json"` for this call.
2. Otherwise use `ext: ".txt"` (the default, unaffected for every other rule —
   none of the other 26 rules branch on `ext` at all, confirmed by grepping the
   bundle for `source.ext ===`, which returns only the two GCP branches above).

The `.p12` case is not addressed: `.p12` files are binary and do not appear as
JSON-parseable or otherwise well-formed text in tool output, so there is no
text-based fixture that could steer a text-only redaction pipeline into that
branch. This is recorded as a residual limitation alongside the proposal's other
documented v1 gaps, not fixed.

Per call, `lintSource` uses this now content-dependent virtual source descriptor:
`{ filePath: <virtual, matching ext>, content: text, ext: <".json" | ".txt">, contentType: "text" }`
and `{ config, noPhysicFilePath: true, maskSecrets: true }`.

**The virtual `filePath` must be provably non-existent.** `noPhysicFilePath: true`
only affects `context.getSourceFilePath()`; the GCP p12 rule reads `source.filePath`
directly via `fs.readFileSync`. A path that happened to exist would be read off
disk on every tool call. The design therefore fixes the constant path under
`/dev/null/` — e.g. `/dev/null/opencode-redact/tool-output.txt` or
`/dev/null/opencode-redact/tool-output.json` depending on the detected ext. Because
`/dev/null` is a character device and not a directory, any path beneath it can
never resolve; the read always fails with `ENOTDIR` and is swallowed by that
rule's own `catch { }`. This is a stronger guarantee than picking a temp-like path
that merely looks unlikely.

The config object is built once and reused for every call. `lintSource` does not
mutate it. The cheap `JSON.parse` attempt for ext detection is bounded by the same
prescreen-before-full-scan ordering in D2 — it only runs on output that already
passed the prescreen, not on every tool call.

### D7 — Dependency resolution for a symlinked plugin with real dependencies

**Decision: the secretlint packages need no symlink workaround. `npm install` in
the repo is sufficient.** This is a change from the proposal's expectation that the
`opencode-use` fix would have to be repeated, and it rests on two independent
reasons:

1. **Realpath resolution.** Node and Bun resolve a symlinked entry file to its real
   path before module resolution (absent `--preserve-symlinks`). A bare specifier
   in `src/index.js` therefore walks up from `~/git/opencode-redact/src/`, finds
   `~/git/opencode-redact/node_modules/`, and resolves.
2. **secretlint anchors on itself, not on us.** `@secretlint/config-loader` resolves
   rule packages through `@secretlint/resolver`'s `tryResolve`, which is
   `createRequire(import.meta.url).resolve(...)` — anchored to the *resolver
   package's own file location*, with `SecretLintModuleResolver`'s `baseDirectory`
   defaulting to `""` so the specifier stays bare. Resolution therefore walks up
   from inside `~/git/opencode-redact/node_modules/@secretlint/resolver/module/`
   and finds the flat-installed preset. This holds regardless of how the entry file
   was reached, so it does not even depend on reason 1.

Reason 2 also removes the concern the proposal raised about the resolver resolving
"relative to its own package location" — that property is what makes this work, not
what breaks it. And because the preset is a self-contained bundle with no runtime
`dependencies`, only the three declared top-level packages ever need resolving.

**Why `opencode-use` needed the workaround and this does not:** there, the missing
module was `@opencode-ai/plugin`, a *peer* dependency deliberately not installed
into the repo's `node_modules`. There was nothing to walk up to, so a symlink had
to supply it. Real dependencies installed by `npm install` are present, so that
failure mode cannot arise.

**Consequence — do not import `@opencode-ai/plugin` at runtime.** The plugin needs
nothing from it but types. Referencing it only through erased JSDoc `import()`
types means the peer never has to resolve at runtime, and the `opencode-use`
peer-symlink step is not needed here at all. Installation reduces to `npm install`
plus the one plugin symlink.

**To verify at implementation time** — named explicitly, because a unit test run
inside the repo exercises none of this:

- That opencode's Bun loader does not run with `--preserve-symlinks`. If it does,
  reason 1 fails and reason 2 alone must carry the plugin's own three imports —
  which it does not, so a `node_modules` symlink would then be required.
- A load-through-the-symlink smoke check: start opencode with the symlink in place
  and confirm a known-positive fixture is redacted in a real session. This is the
  only step that tests the deployed path.
- That no runtime `import` of `@opencode-ai/plugin` has crept into `src/`.

## Risks / Trade-offs

- **A rule reports a range that does not cover its secret (confirmed in the AWS
  rule)** → uniform token-boundary expansion before merging, so coverage does not
  depend on per-rule range accuracy. Residual: a *future* rule could report a range
  that misses the token entirely rather than partially; expansion cannot fix that.
- **Token-boundary expansion over-redacts dense single-line content** → a finding
  inside minified single-line JSON expands to that whole line, which may be the
  whole output. Accepted: for a security control, over-redaction is the safe
  direction, and the annotation tells the model the content was replaced.
- **The GCP JSON rule redacts the entire output** (`range: [0, length]`) → by
  design; a service-account JSON is a secret in its entirety. Documented so it is
  not mistaken for a splice bug.
- **The GCP rule only runs when `source.ext` is `.p12` or `.json`, confirmed by
  reading the bundle** → D6 now detects JSON-shaped text and sets `ext: ".json"`
  for that call, closing the JSON gap. **The `.p12` case remains unaddressed**:
  `.p12` is a binary format with no text-based fixture that could route a
  text-only pipeline into that branch. Documented as a residual v1 gap, alongside
  the other proposal-level limitations (unscanned errors, pre-hook truncation
  spill, unscanned metadata/attachments).
- **The AWS access-key-id and account-id checks never fire under this plugin's
  configuration** — confirmed empirically: both are gated behind an
  `enableIDScanRule` option this design does not set, defaulting to `false`. Only
  the AWS secret-access-key check is reachable. Not a gap needing a fix — access
  key IDs alone are not secrets — but recorded so the D2 anchor table's two
  now-unreachable rows are not mistaken for active detection paths.
- **The wall-clock timeout cannot interrupt synchronous regex execution** → the
  prescreen keeps most content out of the linter, and the preset documents
  ReDoS-conscious bounded patterns. Residual: a crafted input can still block the
  event loop for the duration of one rule's backtrack. Isolation via worker thread
  is the known escalation if this is ever observed.
- **Over-redaction breaks a legitimate agent workflow** — e.g. reading a config to
  edit it, and the read comes back redacted → the annotation instructs the model
  not to write the placeholder back, and the fast opt-out is removing the symlink.
  No config-based bypass exists in v1, by choice.
- **The prescreen's marker list goes stale on a preset upgrade** → the per-rule
  conformance test fails on any new rule whose fixture the prescreen misses.
  Residual: the test's fixtures are themselves hand-written and must be extended
  when the preset adds rules; the test failing loudly is the mitigation.
- **`secret` and `account` are noisy anchors** → many clean outputs will be fully
  linted. Accepted deliberately: the AWS rule's optional `AWS` prefix makes the
  narrower anchor a correctness bug, and a permissive prescreen is the stated
  preference. (The `account` anchor corresponds to the now-confirmed-unreachable
  AWS account-id check — kept anyway since it is cheap and harmless.)
- **Supply chain: 28 bundled rules run over every tool output** → normal lockfile
  and `npm audit` discipline; no additional mitigation in v1.
- **Hook ordering relative to another `tool.execute.after` plugin is undefined** →
  carried over from the proposal; not addressed in v1.

## Migration Plan

New standalone repository; nothing to migrate.

- **Deploy:** `npm install` in `~/git/opencode-redact`, then symlink
  `src/index.js` into `~/.config/opencode/plugins/opencode-redact.js`, then
  restart opencode. No opencode config change. No peer-dependency symlink (D7).
- **Verify:** the load-through-symlink smoke check from D7 — a session in which a
  known-positive fixture comes back redacted.
- **Rollback:** remove the symlink and restart. There is no config flag; this is
  the documented off switch and belongs in the README.

## Component Breakdown

| Component | Work kind | Done when |
|---|---|---|
| `src/redact.js` — prescreen, normalise/expand, merge, splice, labels, annotation, `redactSecrets` | Application code (JS ESM) | All named functions exist with the D1 signatures; `redactSecrets` takes `lint` by injection and imports nothing from secretlint. |
| `src/secretlint.js` — config singleton and bound linter | Application code (JS ESM) | Config built once from the fixed descriptor; linter passes the D6 virtual source and applies the D5 timeout race. |
| `src/index.js` — hook wiring | Application code (JS ESM) | Exports `default` only; awaits config at factory time and rethrows on failure; handler mutates `output.output` in place and swallows all errors. |
| Unit suite for the pure core | Test code (vitest) | Proposal's test matrix passes against a stub `lint`; the half-open convention is pinned by an exact-string assertion; overlap and adjacency produce one placeholder. |
| Per-rule prescreen conformance suite | Test code (vitest) | One known-positive fixture per preset rule; each asserts both `looksLikeSecret === true` and a real finding from the real linter. |
| Export-surface guard | Test code (vitest) | Asserts `src/index.js` has no named exports, mirroring the `opencode-use` guard. |
| README | Documentation | Covers install (incl. the no-peer-symlink note), the removal-based off switch, the v1 limitations from the proposal, and the over-redaction behaviour. |
| Deployment verification | Shell / manual | The D7 smoke check performed and its result recorded. |

## Open Questions

Both are safely deferrable: neither changes the module split, the algorithms, or
the breakdown above.

- The concrete `timeoutMs` default. A value in the low seconds is the starting
  point; it is a tuning constant, observable from real sessions, and changing it
  touches one literal.
- Whether opencode surfaces a plugin-factory rejection prominently enough for the
  fail-loud intent in D5 to hold in practice. Verifiable during the D7 smoke check;
  if the loader swallows it quietly, the fallback is an additional `error`-level log
  before the rethrow, which is already present.
