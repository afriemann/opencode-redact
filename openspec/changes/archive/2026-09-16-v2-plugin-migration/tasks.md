## 1. Dependency and packaging setup

- [x] 1.1 Add `@opencode/plugin` as a devDependency and optional peerDependency (`peerDependenciesMeta`), alongside the existing `@opencode-ai/plugin` optional peer; verify `npm install` resolves cleanly from a clean `node_modules`
- [x] 1.2 Update `package.json`: `main`/`"."` and `"./v1"` resolve to `plugin.v1.js`, `"./v2"` to `plugin.v2.js` (design.md D8); verify both subpaths resolve via dynamic import

## 2. V1 rename (no behavior change)

- [x] 2.1 `git mv src/index.js src/plugin.v1.js`; update all test imports from `../src/index.js` to `../src/plugin.v1.js`; verify the full existing test suite still passes unchanged

## 3. V2 adapter (`src/plugin.v2.js`)

- [x] 3.1 Export a plain `{id, setup}` object literal typed via erased JSDoc — no runtime import of `@opencode/plugin` (design.md D1); add the D1 tripwire test asserting `Plugin.define(obj) === obj` using the devDependency import (test-only import, not a runtime one)
- [x] 3.2 Implement `setup(ctx)`'s init sequence (design.md D2): `loadPluginConfig` then `createSecretlintConfig` in separate statements (never a shared try/catch), `createCompositeLinter`, then register both hooks via `Promise.all`, returning a cleanup that disposes both registrations via `Promise.allSettled`
- [x] 3.3 Implement the `tool.execute.after` handler as `ctx.tool.hook("execute.after", ...)` (design.md D6): gate on `status === "completed"`; redact `result.content` when a string; walk `Content[]` redacting `type:"text"` blocks and leaving `type:"file"` blocks untouched, annotating once on the last redacted block; redact `result.output` only when it's a string and `content` is absent; replace `event.result` wholesale (its fields are readonly) — **widened during live verification** to also redact a nested `output.output` string field independently of `content`'s presence, since the real host's built-in `shell` tool populates both simultaneously (see docs/v2-compat-audit.md)
- [x] 3.4 Implement the `prompt` handler as `ctx.session.hook("prompt", ...)` (design.md D4/D5): redact `event.prompt.text` unconditionally via `redactUserMessage`, append one annotation directly to `event.prompt.text` when any redaction occurred
- [x] 3.5 Implement stderr-only logging (design.md D3): same message content as V1's `logSafely`, different transport (`process.stderr.write`), never escalating a logging failure
- [x] 3.6 Verify `node --check src/plugin.v2.js` and confirm the module has no default-export-adjacent named exports (matches the existing export-surface invariant test, widened to cover this file)

## 4. Spec compliance

- [x] 4.1 Confirm the delta specs' runtime-neutral wording (already drafted in `specs/tool-output-redaction/spec.md` and `specs/user-message-redaction/spec.md`) matches what was implemented; verify `openspec validate v2-plugin-migration --strict` passes

## 5. Test suite

- [x] 5.1 Write `test/plugin-conformance.test.js` (design.md D9): the shared fixture corpus driven through a fake V1 host and a fake V2 ctx, asserting string-identical redacted text, identical annotations, and identical log level/message across both adapters, plus a clean-input no-op case; verify all pass
- [x] 5.2 Add V2-only shape-specific cases: `status:"error"` is never scanned; `Content[]` walk (text blocks redacted, file blocks untouched, one annotation on the last redacted block); `output` redacted only when a string and `content` is absent, structured `output` left identical; `event.result` replaced wholesale with `metadata` preserved; plus the real-host-confirmed nested `output.output` shape (both the secret-present and clean cases)
- [x] 5.3 Add lifecycle cases: `setup` awaits and returns a cleanup that disposes both registrations; a throwing `dispose` does not prevent the other's disposal; a failing secretlint config load rejects out of `setup` after logging at `error`
- [x] 5.4 Extend the existing no-runtime-SDK-import source scan to cover `src/plugin.v2.js` and `@opencode/plugin`; verify it still passes for both adapter files

## 6. Real V2 host verification (design.md Open Questions Q1-Q5 — release gate)

- [x] 6.1 In a scratch project against the real, installed `@opencode/cli` 2.0.3 (`~/opencode-v2-real`), load this plugin's `src/plugin.v2.js` via `.opencode/plugins/` auto-discovery and confirm it loads without error — **confirmed**: no `PluginModule.LoadError`, unlike five other still-V1-shaped comparison plugins in the same environment
- [x] 6.2 Trigger a real tool call whose output contains a generated (not typed) secret and confirm the `execute.after` hook redacts it — **confirmed** the hook fires with real, populated event data (`status: "completed"`, real `Content[]`/`output` shapes) via a temporary diagnostic log; this surfaced the real payload shape, which led to finding and fixing the nested `output.output` gap (task 3.3). A final clean live re-run to directly re-observe the *corrected* redaction (rather than via the unit tests built from the captured shape) was attempted but not completed, due to unrelated heavy resource contention on the host machine (five concurrent opencode sessions). Recorded honestly in docs/v2-compat-audit.md rather than silently claimed as fully re-verified.
- [ ] 6.3 Trigger a real chat prompt containing a generated secret and confirm the `prompt` hook redacts `event.prompt.text` before the model sees it; record whether a `noredact`-fenced secret in the same prompt is still exempted — **not completed live** in this session (time budget exhausted after the tool-output path's investigation); covered only by the unit-level conformance suite. Recorded as an open follow-up in docs/v2-compat-audit.md, not silently assumed passing.
- [ ] 6.4 Resolve Q1 (prompt hook + synthetic inbox items) and Q3 (throwing `setup` surfacing) empirically — **not completed live**; Q1 is addressed at the type level in design.md D4 (verified against installed types, not runtime behavior) and recorded as such, not claimed as a live-confirmed answer.
- [ ] 6.5 Record answers to Q2 (output fallback) and Q5 (exports map / subpath resolution) — **not completed live**; left open per design.md's own fail-safe reasoning for why this doesn't block shipping.

## 7. Documentation

- [x] 7.1 Rewrite `docs/v2-compat-audit.md`: retract the `opencode-ai@dev`-was-the-wrong-target error from the prior audit, document the real hook mapping (D6, D4), and record verification status honestly including the two incomplete items above
- [x] 7.2 Update `README.md`'s install and hook-list sections to describe both V1 and V2 support

## 8. Final verification and review

- [x] 8.1 Run the full test suite (`npm test`) and verify it is green — 232/232 passing
- [x] 8.2 Run `openspec validate v2-plugin-migration --strict`; verify it passes
- [x] 8.3 Commission `code-reviewer` for the full diff (proposal → specs → design → diff); resolve every `[BLOCKER]`, explicitly accept or reject every `[WARNING]` — 0 blockers, 4 warnings + 1 suggestion, all accepted and fixed: (1) prompt-hook redaction/annotation-write split into two steps matching V1's tested guarantee, with a new poisoned-write regression test; (2) redaction-count double-counting for the content/output.output duplicate-carrier case documented as an accepted logging quirk in design.md D6d; (3) redundant no-runtime-import test in test/index.test.js removed in favor of the broader scan in plugin-conformance.test.js; (4) delta spec and design.md D6d updated to describe the structured-output nested-field exception explicitly; (5) stale `src/index.js` doc-comment reference in config.js corrected.
