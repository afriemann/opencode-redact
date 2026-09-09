## Why

opencode-redact currently only scans tool *output* for secrets before it reaches the model. A user typing or pasting a secret directly into their own chat message is not scanned at all — the secret reaches the model and the persisted transcript unredacted. Extending the existing redaction logic to user-authored message text closes this gap using the same detection engine already in place, while giving the user a deliberate, low-friction way to send content they know is safe (e.g. checksums, hashes) without triggering a false-positive redaction.

## What Changes

- Register a new `chat.message` plugin hook that scans **non-synthetic** `text`-type parts of an incoming message for secrets, reusing the existing secretlint-based detection engine (shared `lint` instance, same startup config). Parts with `synthetic === true` (expanded `@file` mentions, directory listings, subagent/task-tool prompts, decoded pastes) are explicitly out of scope for this change — scanning them is deferred to a future change, and remaining unscanned is a documented known limitation (no regression: this content is unscanned today too). This also means the hook is a no-op for subagent-authored turns, since a subagent's prompt text arrives as a synthetic part.
- Extract the current detect-merge-splice logic out of `redactSecrets()` into a new pure function `scanAndRedact(text, { lint })` that returns `{ text, redactionCount, ruleIds }` without any annotation. `redactSecrets()` becomes a thin wrapper around `scanAndRedact()` that appends the existing tool-output annotation — this refactor must not change tool-output-redaction behavior (proven via a before/after snapshot of `redactSecrets` outputs across the existing fixture set).
- Add a new fenced-block exemption convention: any content wrapped in a ` ```noredact ... ``` ` fenced block (opening fence of 3+ backticks followed by the case-insensitive token `noredact`, closed by a matching bare-backtick fence) is passed through completely unscanned. This applies at the segment level — a fence may exempt part of a non-synthetic message while the surrounding text is still scanned. Malformed/unterminated fences are NOT treated as exempt (fail-safe: still scanned).
- Add `redactUserMessage(text, { lint })`, which splits text into exempt/non-exempt segments, redacts only non-exempt segments, and — when anything was redacted anywhere in the message — appends exactly **one** aggregated annotation (`buildUserMessageAnnotation`) covering the total redaction count and the union of rule ids across all segments. The annotation tells the model that a redaction occurred in the message and that a placeholder is not the real value (mirroring the existing tool-output annotation's caution) — it does **not** mention the `noredact` fence or otherwise describe how to bypass scanning, so the exemption mechanism is never taught to a model.
- The hook must never reject/throw for any reason (missing/non-array `parts`, non-string `text`, a throwing getter, etc.) — an uncaught rejection in this hook becomes a fatal defect that aborts the user's entire turn, not just the redaction step, so exhaustive try/catch coverage is a hard requirement, not an assumption inherited from the existing hook.
- Update README with the new hook's behavior, the ```noredact``` fence syntax and its segment-level (not whole-part) semantics, the non-synthetic-parts-only scope, and new "known limitations" entries (synthetic/attached content is not scanned; fail-safe fence handling; a possible TUI optimistic-render gap analogous to the existing tool-output streaming-preview limitation; segment-splitting can suppress `detectExt`'s JSON-based detection, e.g. a GCP key, if a fence splits the JSON blob).

## Capabilities

### New Capabilities
- `user-message-redaction`: scanning and redacting secrets found in non-synthetic (user-typed) chat message text via the `chat.message` hook, including the segment-level ```noredact``` fence exemption mechanism and its aggregated, fence-agnostic model-facing annotation.

### Modified Capabilities
(none — the `scanAndRedact` extraction is an internal refactor of `tool-output-redaction`'s implementation with no requirement-level behavior change; the existing `tool-output-redaction` spec is unaffected.)

## Impact

- `src/redact.js`: new exported functions (`scanAndRedact`, `splitNoRedactSegments`, `redactUserMessage`, `buildUserMessageAnnotation`); `redactSecrets()` refactored to a thin wrapper.
- `src/index.js`: new `chat.message` hook registration alongside the existing `tool.execute.after` hook, sharing the same `lint` instance; hook filters to non-synthetic text parts only and never throws.
- `test/redact.test.js`, `test/index.test.js`: new unit and integration test coverage, including a before/after snapshot proving the `scanAndRedact` extraction is behavior-preserving for existing tool-output fixtures.
- `README.md`: documentation updates, including new known-limitations entries.
- No new dependencies. No new configuration surface — the fence is an inline textual convention only.
- Out of scope for this change: scanning synthetic parts (attached file content, directory listings, decoded pastes, subagent/task-tool prompts) — tracked as a known limitation for a future change.
