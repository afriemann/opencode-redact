# Proposal

## Product intent

Actors: the user and their opencode sessions. Job: keep secrets out of everything the LLM receives. Must keep: redaction on by default with no opt-out, a non-blocking host, a stable provider prompt cache. Trust model: user and host trusted; tool output and file content untrusted.

## Why

V1 support is no longer needed, and a static audit against the `opencode-plugin-dev` guidelines found hidden model-facing edits, cache instability, event-loop blocking on large inputs (measured: 200 KB scans block the loop for about 5 s), non-conforming logging, and ignored `ctx.options`.

## What Changes

- **BREAKING** Remove V1: `src/plugin.v1.js`, V1 tests, the `./v1` export, the `@opencode-ai/plugin` peer. `.` points to the V2 entry using `Plugin.define`; `@opencode/plugin` becomes a required peer.
- **BREAKING** Remove every in-band `[opencode-redact] ...` annotation. One visible `ctx.session.synthetic` row per session announces redaction and carries the placeholder guidance. The README discloses rewritten and unscanned channels.
- Memoise successful scans per session so request prefixes stay byte-stable.
- Slice large scans without missing boundary-straddling secrets, and yield to the event loop; fix the superlinear scan cost.
- `ctx.options` is read and validated, but can only tighten settings; `disableHighEntropy: true` is honoured only from the user-level `redact.jsonc`.
- The character budget no longer leaves oversized strings unscanned: every string is scanned once slicing lands. Visit and depth caps remain structural limits.
- Logging: one JSON line per entry with `service`, variable data in `extra`, error class or code instead of raw messages, init and options `info` logs, one `debug` audit line per edit.
- CI: `actions/setup-node` pinned by SHA; Node matrix `22.5` and `24`.

## Capabilities

### New Capabilities
- `redaction-disclosure`: the visible per-session row, and one audit event per hidden edit.
- `scan-performance`: non-blocking scans, boundary-safe slicing, stable repeated redaction.

### Modified Capabilities
- `plugin-configuration`: `ctx.options` handling.
- `tool-output-redaction`: no annotation; V1-only scenarios removed.
- `user-message-redaction`: no annotation.
- `request-payload-redaction`: no annotation.

## Impact

`src/` (entry, new `setup.js`, `redact.js`, `entropy-rule.js`, `prescreen.js`, `config.js`), `package.json`, tests, README, AGENTS.md, `docs/v2-compat-audit.md`, `.github/workflows/ci.yml`.
