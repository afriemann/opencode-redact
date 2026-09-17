## Why

A later architectural review of the V2 port (`src/plugin.v2.js`) found two
coverage gaps in this plugin's completeness guarantee — "no secret ever
reaches the model, logs, or any downstream sink":

1. opencode V2 exposes three separate session hooks — `context`, `generate`,
   and `compaction` — that assemble or re-derive the exact payload sent to a
   model provider (`event.system: SystemPart[]` and `event.messages: Message[]`).
   None of these hooks is currently registered. System content assembled from
   skills, `AGENTS.md`, reference docs, or MCP tool descriptions could carry an
   accidentally-committed secret and it would reach every provider call
   completely unredacted today. The `generate` hook can also be invoked by any
   other installed plugin with arbitrary prompt text, bypassing this plugin
   entirely.
2. `redactToolResult`'s tool-result redaction patches `Tool.Result`'s fields
   one at a time as they were empirically discovered (`content` as a string,
   `content` as blocks, `output` as a bare string, nested `output.output`).
   `Tool.Result.metadata` is never scanned at all, and the existing test suite
   currently locks in that gap by asserting metadata passes through
   byte-identical.

## What Changes

- Register `ctx.session.hook("context", ...)`, `ctx.session.hook("generate", ...)`,
  and `ctx.session.hook("compaction", ...)` in `src/plugin.v2.js`, redacting
  `event.system[].text` (every `SystemPart`) and each `event.messages[].content[]`
  text-typed block, reusing the existing block-walking / string-scanning
  logic already used for `Tool.Content[]`.
- Add a schema-agnostic recursive string walk over `Tool.Result.metadata` —
  the one field `redactToolResult` never scanned at all — redacting every
  string leaf via the existing `scanAndRedact` pipeline, bounded by a
  max-scanned-character budget consistent with the plugin's existing
  per-scan timeout. `content` and `output` keep their existing, already-tested
  handling unchanged (see design.md D4's implementation-time correction).
- Update the existing test that currently asserts `event.result.metadata`
  passes through untouched (`test/plugin-conformance.test.js`, "preserving
  metadata") to instead assert a secret placed in `metadata` is redacted.
- **Explicitly out of scope (rejected by the review):** registering
  `ctx.session.hook("http.request"/"http.response", ...)`. The wire body is
  serialized from the same `Message`/`Tool.Result` objects already redacted
  upstream by the hooks above — duplication with real added fragility and no
  net coverage gain.

## Capabilities

### New Capabilities
- `request-payload-redaction`: redacts secrets from the system prompt and
  message-history payload assembled for every provider call (V2 `context`,
  `generate`, and `compaction` session hooks), independent of the
  tool-output and user-message redaction paths.

### Modified Capabilities
- `tool-output-redaction`: the "Handle Non-Scannable Output Gracefully"
  requirement's carve-out for structured (non-string) values is replaced —
  a tool result's `metadata` field (and every other field of the result
  object) is now included in the recursive string scan, not just the one
  previously-discovered nested `output.output` field.

## Impact

- `src/plugin.v2.js`: three new hook registrations; `redactToolResult`
  rewritten as a recursive walk.
- `test/plugin-conformance.test.js`: new hook-coverage test cases; the
  metadata-preservation test changed to a metadata-redaction test.
- No new dependencies, no config surface change, no changes to `src/plugin.v1.js`
  (V1 has no equivalent hooks to this gap).
