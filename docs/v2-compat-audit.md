# opencode V2 contracts — `opencode-redact`

Host behaviour this plugin depends on, traced against OpenCode 2.0.26 source
and the published `@opencode/plugin` definitions. Packaging: the default
export (`.`) and `./v2` are the same `Plugin.define` entry, so the package
can be listed by name in the config `plugins` array.

## V2 content-part and ownership contracts

The ownership and serialization traces below apply to inspected OpenCode
2.0.26 source. The published `@opencode/plugin@2.0.4` definitions also expose
`SessionHooks.title` and include `title` in `SessionRequestKind`, so title
registration needs neither a peer-floor increase nor a compatibility shim.

### Signed reasoning is exempt — provider SDKs reject modified thinking

A `reasoning` part carries `providerMetadata` proof-of-generation scoped to
the model that produced it (Anthropic message/thinking signature, Gemini
thought signatures, OpenAI encrypted reasoning). The handler leaves
`reasoning` parts unmodified: Anthropic and AWS Bedrock reject a request
whose thinking blocks were modified after generation, so editing signed
reasoning is not a compatible redaction policy. Secrets in these parts
remain unredacted. Redacting
signed reasoning is deferred until a provider-compatible confidentiality
policy exists, with a tool-use/replay regression test; see the README's
"Known limitations" entry.

### Hook-bound history is a per-request derivation, not the persisted record

Trace of what the host hands the session hooks (`context`, `generate`,
`compaction`, `title`) and what it keeps:

- **Per-request assembly.** `packages/core/src/session/model-request.ts`
  `baseTranscript` (:100-120) builds fresh `system` and `messages` arrays
  for each request through `SystemPart.make(...)` and `toLLMMessages(...)`.
- **Fresh objects per message.** `to-llm-message.ts` `toLLMMessage`
  (:253-334) constructs entirely new `Message` objects from projected
  `SessionMessage.Info` fields; the assistant branch (:153-233) builds new
  part objects — and only attaches reasoning `providerMetadata` when the
  part was produced by the same model without error/interruption,
  degrading otherwise.
- **What the hook receives.** `model-request.ts:420-428` passes session
  hooks a fresh wrapper `{...draft, agent, tools}` whose `system`/`messages`
  reference the draft; the hook's result (trigger has no cloning —
  `plugin/hooks.ts:88-95` invokes callbacks with the same object) is
  consumed **only** for the outgoing request (`:296-297`:
  `system: shaped.system`,
  `messages: boundImages(unsupportedParts(shaped.messages, ...))`).
- **Why the plugin still copies.** Inner objects are not always fresh:
  `toolInput()` (`to-llm-message.ts:111-115`) hands the stored
  `tool.state.input` object through by reference, and metadata objects may
  be shared. The plugin's deep walk is strictly copy-on-write —
  `redactObjectStrings` rebuilds only containers whose strings changed and
  returns original references otherwise; `redactTextField`/
  `redactObjectField` spread; `redactContentArray` replaces only array
  **slots**. No part object or shared nested object is ever written in
  place on this path (pinned by the deep-frozen-parts conformance test).
- **All four assembly points share this shape.** The auxiliary
  `title`-generation request is another session-request kind carrying the
  same `SessionContext`; the plugin registers
  `ctx.session.hook("title", ...)` with this same handler, so it is covered
  by the trace above exactly like `context`/`generate`/`compaction`.

Conclusion: a secret that hits a session hook lives in a payload built for
this one provider call; replacing array slots can rewrite that payload but
cannot reach the canonical stored session, and the plugin leaves the
original part objects untouched. The conformance tests cover all three
invariants (payload redacted vs. snapshot preserved, frozen parts never
written, replaced slots leaving originals' raw values intact).

### Tool-call signature metadata and ordering

In `packages/ai/src/protocols/gemini.ts:728-769`, the decoder maps
`functionCall.args` to `input` and the same part's `thoughtSignature` to
`providerMetadata[providerMetadataKey].thoughtSignature`. Outbound
serialization (:293-303) maps these independently; :341-386 retains part
order and permits unsigned parallel siblings after a signed first call.

Google's GenerateContent thought-signature contract requires retaining each
signature on its original part and maintaining call ordering, including
parallel siblings. The inspected contract does not establish whether the
signature cryptographically binds argument bytes. The plugin redacts inputs
while preserving metadata, identifiers, names, ordering, and original part
objects. Conformance coverage checks this transport boundary; it does not
claim successful live-provider replay or undocumented argument-binding
behavior. See [Google's thought-signature guide](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures).

### Structured traversal boundaries

V2 metadata, error objects, and structured history inputs/result values are
walked with at most 10,000 value visits per tool-result scan or request-hook
invocation and a 128-container path limit. Every string reached is scanned in
full; large strings are scanned in bounded slices that yield to the event loop.
Cyclic back-edges and deeper branches stay unchanged. Independent siblings
continue, and each skip reason produces one payload-free warning per
tool-result scan or request-hook invocation. All structured history
inputs/results share that request's visit budget. Tracking ancestors rather
than all visited objects allows shared, acyclic inputs to be redacted at each
occurrence without mutating their source. When the visit budget runs out,
unvisited branches remain unchanged. Copy-on-write preserves own property
descriptors, throwing accessors, and sparse array holes on plain objects
(including null-prototype records) and arrays. Other prototypes, including
Date, Map, Error, and class instances, remain unchanged and unscanned;
secrets in their fields can therefore pass through. Host execution errors
still use the separate in-place path to retain identity.

These are fail-open limits, not a guarantee that every secret is scanned.
The prescreen only bypasses anchored preset rules; entropy scanning still
runs for nonempty strings when enabled, so it is not a full clean-text bypass.
A failed system or message container logs a payload-free error without
preventing later messages from being scanned.

### Scoped exception: `tool.execute.after` does rewrite its record

The one hook whose mutation reaches a persisted record is
`tool.execute.after`: for a **failed** tool call the hooked object **is**
the execution's `Tool.Error` (`packages/core/src/tool.ts:103-156`),
redacted in place (`redactValueInPlace`), and the same object later
surfaces/persists in the tool's state; for a completed call, the hooked
result's fields flow into what the tool returns. That is the hook's own
upstream semantics, accepted as the intended design — noted
here so the distinction with the session hooks is explicit.
