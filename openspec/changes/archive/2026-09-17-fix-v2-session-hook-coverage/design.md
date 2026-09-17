# Design — fix-v2-session-hook-coverage

## Context

`src/plugin.v2.js` (from the archived `v2-plugin-migration` change) registers
exactly two V2 hooks: `ctx.tool.hook("execute.after", ...)` and
`ctx.session.hook("prompt", ...)`. A later architectural review found that
three more session hooks — `context`, `generate`, `compaction` — assemble or
re-derive the payload actually sent to a model provider, and none of them is
registered. It also found that `redactToolResult`'s tool-result handling never
scans `Tool.Result.metadata`.

### Verified platform facts (read 2026-09-17 from installed `@opencode/plugin`/`@opencode/ai` source)

From `node_modules/@opencode/plugin/dist/promise/session.d.ts`:

```ts
export interface SessionRequest {
  readonly sessionID: Session.ID;
  readonly model: Model.Ref;
  system: Array<SystemPart>;
  messages: Array<Message>;
  options: SessionRequestOptions;
}
export interface SessionContext extends SessionRequest {
  readonly agent: Agent.ID;
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>;
}
export interface SessionCompaction extends SessionContext {
  result?: SessionCompactionResult; // set to skip the model request
}
export interface SessionGenerate extends SessionContext {}
export interface SessionHooks {
  readonly prompt: SessionPrompt;
  readonly context: SessionContext;
  readonly compaction: SessionCompaction;
  readonly generate: SessionGenerate;
  readonly title: SessionTitle;
  ...
}
```

- **`context`, `compaction`, and `generate` all share the `SessionContext` shape** —
  `system: Array<SystemPart>` and `messages: Array<Message>`, both mutable
  (no `readonly`). `compaction` adds an optional `result` (set to skip the
  model call — not touched by this change); `generate` adds nothing.
- **`SystemPart`** (`@opencode/ai/dist/schema/messages.d.ts`):
  `{ type: "text"; text: string; cache?; metadata? }` — always `type: "text"`,
  never a union. `.text` is the field to scan.
- **`Message`** is `{ id?; role; content: ContentPart[] }`. `ContentPart` is a
  tagged union over `type`: `"text"` (`{text}`), `"media"`, `"tool-call"`,
  `"tool-result"`, `"reasoning"` (`{text}`), `"compaction"` (`{text?}`),
  `"effort"`. Only `"text"` blocks have the exact `{type:"text", text}` shape
  already handled by this plugin's existing `Tool.Content[]` walk
  (`redactContentBlock` in `src/plugin.v2.js`, from the archived design's D6c).
- **`title` is a fourth `SessionRequest`-shaped hook** (no `agent`/`tools`,
  has an optional `result: string` to skip the model call) — out of scope
  for this change (see Non-Goals).
- **`Tool.Result`** (unchanged from the archived design):
  `{ readonly output?; readonly content?; readonly metadata? }`. Nothing in
  the type surface constrains `metadata`'s shape beyond
  `Record<string, unknown>` — it is genuinely schema-agnostic.

## Goals / Non-Goals

**Goals**

- Redact `event.system[].text` and each `event.messages[].content[]` text
  block for the `context`, `generate`, and `compaction` hooks, using the
  same block-shape (`{type:"text", text}`) the existing `Tool.Content[]`
  walk already handles — no new block-walking logic, reuse
  `redactContentBlock`.
- Replace `redactToolResult`'s named-field patching with one recursive,
  schema-agnostic string walk over the whole `event.result` object so
  `metadata` (and any future undiscovered field) is covered without another
  empirically-discovered-gap cycle.
- Keep the walk bounded: a size/count cap consistent with the plugin's
  existing per-scan timeout, so a pathological `metadata` blob cannot make
  redaction itself the resource problem.

**Non-Goals**

- No `title` hook. It shares `SessionRequest`'s `system`/`messages` shape and
  could theoretically get the same treatment, but the review scoped this
  change to the three hooks the brief named; `title` requests are typically
  a small system+messages payload asking for a short session title, a much
  lower-risk surface, and adding a fourth hook without the review's explicit
  sign-off is scope creep. Track as a candidate follow-up, not silently
  folded in here.
- No `http.request`/`http.response` hooks (explicitly rejected — see
  proposal.md).
- No redaction-engine change. `scanAndRedact`/`redactSecrets`/`buildAnnotation`
  are reused unmodified.
- No change to `src/plugin.v1.js` — V1 has no equivalent hook.
- No change to non-text `ContentPart` variants (`media`, `tool-call`,
  `tool-result`, `reasoning`, `compaction`, `effort`) — same boundary the
  existing `Tool.Content[]` walk already draws at `type !== "text"`
  (archived design.md D6c: "file" blocks left untouched). Widening the
  walk to reasoning/compaction text is a candidate follow-up, not silently
  included here.

## Decisions

### D1 — Three new hooks share one handler, keyed by shared `SessionContext` shape

`context`, `generate`, and `compaction` all extend `SessionContext` and need
identical treatment (walk `system[]`, walk `messages[].content[]`). Rather
than three near-duplicate handlers, one `redactSessionContext(event, {lint})`
function is registered under all three hook names:

```js
ctx.session.hook("context", (event) => redactSessionContextHandler(event, {lint}, log)),
ctx.session.hook("generate", (event) => redactSessionContextHandler(event, {lint}, log)),
ctx.session.hook("compaction", (event) => redactSessionContextHandler(event, {lint}, log)),
```

Each call gets its own registration/disposal (matching D2's existing
pattern for `execute.after`/`prompt`) — sharing the handler function is not
sharing the hook lifecycle. `compaction`'s extra `result` field is untouched
(D2's own skip-if-set escape hatch is a session-level concern, not a
redaction concern).

### D2 — `event.system[]`: walk with the existing block-shape check, mutate the array in place

Unlike `Tool.Result` (whose fields are `readonly`, forcing a whole-object
replacement per the archived design), `SessionContext.system` is a plain
mutable array. Each element already has the exact `{type:"text", text}`
shape `redactContentBlock` expects (verified above — `SystemPart` is not a
union; every element qualifies). Reuse `redactContentBlock` unchanged:

```js
for (let i = 0; i < event.system.length; i += 1) {
  const redacted = await redactContentBlock(event.system[i], {lint});
  if (redacted.redactionCount > 0) { event.system[i] = redacted.block; ...accumulate }
}
```

One annotation (`buildAnnotation`) is appended to the last redacted system
part's `.text`, mirroring D6c's "one annotation on the last redacted block"
rule from the archived design — this is the same aggregate-then-annotate-once
shape, applied to a different container.

### D3 — `event.messages[]`: walk each message's `content[]`, only `type:"text"` blocks

`Message.content` is `ContentPart[]`, a six-member tagged union. Only
`"text"` blocks share `redactContentBlock`'s exact expected shape; every
other variant (`media`, `tool-call`, `tool-result`, `reasoning`,
`compaction`, `effort`) is left untouched by this change (see Non-Goals).
This mirrors the archived design's own precedent of scanning a narrow,
verified-safe subset of a union (D6c: `Tool.Content`'s `"file"` variant is
skipped) rather than guessing at fields inside variants this change was not
asked to open.

Annotation is aggregated **per message** — one `buildAnnotation` appended to
the last redacted text block within that message's own `content[]` — not
across the whole `event.messages` array. A "message" is the natural
container boundary (the archived design used "the tool result" and "the
system array" as their respective containers); aggregating across
independent messages would conflate unrelated content and complicate
attribution with no observable benefit.

### D4 — `redactToolResult` becomes one recursive string walk over `event.result`

**Correction during implementation.** The original framing below ("applied to
the whole `event.result` object... covering `content`, `output`, AND
`metadata` alike, with no special-casing per field name") turned out to be
too broad: an existing, already-tested behavior requires that an arbitrary
*structured* `output` value (opaque programmatic/codemode data, per the
archived design's D6d) be left **completely untouched** — reference-identical,
not even cloned — whenever `content` is absent. A blanket recursive walk over
`output` would silently start mutating that opaque data whenever it happened
to contain a string matching a secret pattern, which is exactly the risk D6d
was written to avoid, and is not what either finding asked for. **`content`
and `output` keep their existing, narrowly-scoped, already-tested handling
completely unchanged** (string `content`, `Content[]` `content`, bare-string
`output` only when `content` is absent, and the nested `output.output`
duplicate-carrier field). Only `metadata` gets the new recursive,
schema-agnostic walk — because unlike `output`, `metadata` had **zero**
existing scanning behavior to preserve or regress; every `Tool.Result` field
this plugin was already scanning stays exactly as scanned.

`redactObjectStrings(value, {lint}, budget)` is the recursive walker,
applied only to `workingResult.metadata` when that field is a non-array
object:

```js
async function redactObjectStrings(value, {lint}, budget) {
  if (typeof value === "string") { return scanAndRedact-or-skip-if-over-budget leaf }
  if (Array.isArray(value)) { walk each element, rebuild array if any child changed }
  if (value && typeof value === "object") { walk each own-enumerable key, rebuild object if any child changed }
  return value unchanged; // numbers, booleans, null, undefined, functions
}
```

This directly removes the class of bug the review found for `metadata`
specifically: any string field newly added to `metadata` in the future is
covered by construction, with no further empirical-discovery cycle needed.
It deliberately does **not** extend that same guarantee to `output`, because
`output`'s contract (opaque to non-string, model-facing-only for the
narrow already-known shapes) is different from `metadata`'s (always a
plain, non-model-facing `Record<string, unknown>` per the verified
`Tool.Result` type — see Context), and only `metadata`'s change was asked
for.

**Guard rail — recursion budget.** An unbounded walk over an adversarial or
pathological `metadata` blob (deeply nested, or containing very many/large
strings) could make the walk itself slow. The walk is bounded by a
**total scanned-character budget**, consistent with the existing per-string
`DEFAULT_TIMEOUT_MS` (`src/secretlint.js`, 3000ms): a running counter starts
at a fixed cap and is decremented by each string's length before it is
scanned; once the remaining budget is smaller than a candidate string's
length, that string (and only that string) is left unscanned, not
truncated or thrown — same fail-open direction the rest of this plugin
already takes on scanner errors/timeouts. Chosen cap: **200,000 characters
total per `redactToolResult` call** — generous for real tool-result
metadata (small structured records: durations, exit codes, byte counts,
occasionally a short embedded snippet), while bounding the worst case.

**Annotation placement.** `metadata` is not model-facing narrative text (it
is Record<string, unknown> auxiliary structured data, per the verified type)
and has no natural place for a `buildAnnotation` note to live without
fabricating one. No annotation is appended for a metadata-only redaction;
the existing annotation behavior for `content`/`output` string redactions is
completely unchanged. `totalRedactionCount`/`ruleIds` still aggregate a
metadata redaction into the handler's own `warn`-level log line (so it is
never silent), matching this plugin's existing "log the fact of redaction,
never the secret" invariant.

**Mutation mechanics.** Same as the rest of `redactToolResult`:
`Tool.Result`'s fields are `readonly`, so `metadata` is replaced as a whole
new object (`workingResult = {...workingResult, metadata: walked.value}`)
only when the walk found something to change; otherwise the original
`metadata` reference is kept untouched.

### D5 — Metadata test: change the assertion, not just add one

`test/plugin-conformance.test.js`'s "event.result is replaced wholesale
(readonly fields), preserving metadata" test currently uses a metadata
fixture with no secret (`{durationMs: 42}`), so it does not actually
exercise the metadata-scanning gap — it only proves metadata is *preserved
when it never had a secret*, incidentally leaving the string-leaf case
untested. Per the review: the test is changed to place a secret inside
metadata and assert it is redacted, while a sibling non-secret field is
still preserved untouched. The "wholesale replacement, readonly fields"
assertion (`event.result` is a new object) stays; only the metadata-specific
expectation flips from "unchanged" to "the secret leaf is redacted, the
clean leaf is untouched."

## Component breakdown

| Component | Work kind | Done when |
|---|---|---|
| `src/plugin.v2.js` | Application code | Three new `ctx.session.hook` registrations (D1); `event.system[]`/`event.messages[].content[]` walked and redacted (D2, D3); `redactToolResult` replaced by the recursive walk (D4); all existing behavior for `content`/`output`/nested `output.output` preserved through the new walk. |
| `test/plugin-conformance.test.js` | Test code | New cases for `context`/`generate`/`compaction` hook registration, `event.system[]` redaction, `event.messages[].content[]` redaction (text blocks only, other variants untouched); the metadata test changed per D5; a budget-cap case for the recursive walk. |
| Spec deltas for `request-payload-redaction` (new) and `tool-output-redaction` (modified) | Specification | Requirements describe the observable redaction behavior for the new hooks and the widened metadata scan, independent of implementation. |
