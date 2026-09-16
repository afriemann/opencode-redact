## Why

opencode's real V2 product (`@opencode/cli` / `@opencode/plugin`, stable
2.0.4 — a separate package from the legacy `@opencode-ai/plugin` V1 SDK)
does not run V1 plugin implementations at all; a plugin must be ported to
`Plugin.define({id, setup(ctx)})` to run under V2. V1 support remains
available today only via a documented, time-boxed compatibility bridge
("V1 object entrypoints are supported in OpenCode 1.18.29 and newer... remove
the V1 implementation after your support window ends") — this plugin needs
a genuine V2 port, not just a compatibility audit, before that window closes.

This plugin's prior `docs/v2-compat-audit.md` (change `v2-compat-audit`,
already archived) tested against `opencode-ai@dev`, which was later
confirmed to be the wrong target entirely — that package is V1's own
evolving prerelease channel, unrelated to the real, separately-versioned V2
product. This change supersedes that audit with a real port and corrects
the record.

## What Changes

- Rename `src/index.js` → `src/plugin.v1.js` (V1 adapter, behavior
  unchanged) and add a new `src/plugin.v2.js` (V2 adapter), both built on
  the plugin's existing, already runtime-agnostic pure modules
  (`redact.js`, `secretlint.js`, `config.js`) — no new "core" extraction is
  needed since these modules already take zero runtime-shaped input.
- `package.json`: add subpath exports (`.`/`./v1` → `plugin.v1.js`, `./v2`
  → `plugin.v2.js`), add `@opencode/plugin` as an optional peer dependency
  and dev dependency (mirroring `@opencode-ai/plugin`'s existing optional
  peer treatment).
- V2 hook mapping (confirmed against the installed `@opencode/plugin`
  2.0.4 type surface, not guessed):
  - `tool.execute.after` → `ctx.tool.hook("execute.after", (event) => {...})`.
    V2's event shape carries the tool result under `event.result` (either
    `{status:"completed", result: {output?, content?, metadata?}}` or
    `{status:"error", error}`) rather than V1's flat `output` object —
    redaction only applies when `status === "completed"` and
    `result.content` (or `.output`) is a plain string.
  - `chat.message` → `ctx.session.hook("prompt", (event) => {...})`. V2's
    `Prompt` shape is `{text, files?, agents?, skills?}` — a single string,
    not V1's `parts[]` array of typed segments. There is no V2-documented
    `synthetic` flag equivalent on this simpler shape; the V1 adapter's
    per-part `synthetic !== true` exclusion (so `@`-mentions, file bodies,
    and subagent-delivered content are never redacted as if the user typed
    them) has no direct V2 counterpart to preserve — recorded as an
    intentional, design-reviewed scope note, not silently dropped.
- No custom tools are registered by this plugin, so the V2
  `codemode`/tool-visibility fix that applied to `opencode-use` and
  `opencode-auto-instruct` is not relevant here.
- Rewrite `docs/v2-compat-audit.md` to correct the `opencode-ai@dev`-was-
  the-wrong-target record and document the real port's hook mapping and
  test results.

## Capabilities

### Modified Capabilities
- `tool-output-redaction`: requirement wording must describe the redaction
  contract in terms that hold under both the V1 and V2 tool-execution hook
  mechanisms, not just V1's `output.output` shape.
- `user-message-redaction`: requirement wording must describe the
  redaction contract in terms that hold under both V1's `parts[]` array and
  V2's single `Prompt.text` string, and must explicitly scope the
  `synthetic`-exclusion behavior to runtimes that expose that distinction.

## Impact

- `src/index.js` (renamed), `src/plugin.v1.js` (new), `src/plugin.v2.js`
  (new), `package.json` (subpath exports, new optional peer/dev dependency),
  `test/` (import path updates, new V2 adapter-conformance tests),
  `docs/v2-compat-audit.md` (rewritten).
- No behavior change for existing V1 users.
