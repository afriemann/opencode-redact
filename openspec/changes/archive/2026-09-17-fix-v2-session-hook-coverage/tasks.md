## 1. Recursive tool-result redaction (D4/D5)

- [x] 1.1 Write a failing test for "a secret in the tool result's metadata is redacted" (replaces the existing metadata-preservation assertion in `test/plugin-conformance.test.js` per D5) and confirm it fails against current code
- [x] 1.2 Write a failing test for "an unusually large structured result does not block indefinitely" (budget-cap case)
- [x] 1.3 Implement `redactObjectStrings` (recursive, schema-agnostic string walk with a bounded scanned-character budget per D4) in `src/plugin.v2.js`
- [x] 1.4 Replace `redactToolResult`'s field-by-field patching with a call to `redactObjectStrings` over `event.result`, preserving existing annotation placement (content/output string cases) per D4
- [x] 1.5 Run the full existing `execute.after` test suite (content string, content blocks, output string, structured output, nested output.output, tool-error skip) and confirm no regressions

## 2. `context`/`generate`/`compaction` session hooks (D1-D3)

- [x] 2.1 Write a failing test asserting `ctx.session.hook` is called with `"context"`, `"generate"`, and `"compaction"` during `setup`
- [x] 2.2 Write a failing test for "redacts a known-detectable secret in a system prompt segment" (event.system[].text)
- [x] 2.3 Write a failing test for "leaves a clean system prompt segment unchanged"
- [x] 2.4 Write a failing test for "redacts a secret in a message's text content" (event.messages[].content[], type:"text")
- [x] 2.5 Write a failing test for "non-text message content is left untouched" (a tool-call or reasoning content block)
- [x] 2.6 Write a failing test for "one annotation for multiple redactions in the system prompt"
- [x] 2.7 Write a failing test for "no annotation when no redaction occurred" (system prompt and messages)
- [x] 2.8 Implement the shared `redactSessionContextHandler(event, {lint}, log)` in `src/plugin.v2.js`, reusing `redactContentBlock` for both `event.system[]` and each message's `content[]` (D1-D3)
- [x] 2.9 Register the handler under `ctx.session.hook("context", ...)`, `("generate", ...)`, and `("compaction", ...)` in `setup`, each with its own registration/disposal
- [x] 2.10 Update the `lifecycle` test group ("setup awaits both hook registrations...") to account for the three new registrations and their disposal on cleanup

## 3. Verification and archival

- [x] 3.1 Run the full test suite (`npm test`) and confirm all tests pass, including the pre-existing 241 plus every new test added above
- [x] 3.2 Confirm no `src/*.js` file runtime-imports `@opencode/plugin` or `@opencode-ai/plugin` (existing invariant test still passes unmodified)
- [x] 3.3 Update `docs/v2-compat-audit.md` (if present) or add a short note documenting the new hook coverage and the metadata-redaction fix
- [x] 3.4 Get a `code-reviewer` pass on the diff against `proposal.md` → delta specs, resolving every `[BLOCKER]` and disposing every `[WARNING]`
