# Design

## Context

`SessionSyntheticInput` is `{sessionID, id?, text, description?, metadata?, delivery?, resume?}`. `sessionID` is present on `tool execute.after`, `prompt`, `context`, `compaction`, `generate` and `title`. Whether `ctx.session.synthetic` re-fires hooks is unverified.

A 200 KB scan blocks the loop because secretlint runs synchronously, so the timeout race cannot fire mid-scan. The superlinear cost comes from `subtractSpans` and `isWithinAnySpan` in `entropy-rule.js`, which scan all URL, path and numeric spans per run.

## Goals / Non-Goals

Goal: guideline conformance. Non-goal: changing detection rules.

## Decisions

1. **Synthetic row.** Emit from the first hook seen per session carrying a `sessionID`, not the first redaction. A per-session `Set` is marked before awaiting, and an in-flight guard stops hook recursion; both are defences, not proof of safety. Use `delivery: "queue"`, `resume: false`, non-empty `description`, static text. Failures are caught and logged. Child and forked sessions get their own row, re-issued after `compaction`.
2. **Memo.** Per-session `Map`, key = SHA-256(text + fence flag + linter config id). It stores redacted output only. `scanAndRedact` returns an explicit `ok`, since timeout and scanner error currently yield `redactionCount: 0`; only `ok` results are stored. In-flight promises are shared. LRU bounded by entries and bytes; cleared on `session.deleted`, evicted by LRU across sessions, and cleared on plugin dispose.
3. **Slicing.** Cut at the last newline or whitespace in the window. Overlap exceeds the longest detectable secret. PEM blocks stay whole; unbreakable runs are cut hard with overlap. `detectExt` runs once on the whole text. Slice findings are mapped to global offsets and merged before `expandToTokenBoundaries`. A macrotask yield between slices keeps timeouts effective. Replace per-run span lookups with a sorted sweep.
4. **Entry.** `Plugin.define` is a runtime export of `@opencode/plugin` (`export * as Plugin`), imported at runtime; a missing required peer fails at load. `src/setup.js` holds `setup(ctx, overrides)`, so the entry exports only `default`. `ctx.options` is validated and merged tighten-only. Logs are one JSON line with `service` and `extra`.

## Risks / Trade-offs

- The row costs one message per session.
- The memo costs bounded memory.
- Overlap duplicates findings; the merge dedups them.
