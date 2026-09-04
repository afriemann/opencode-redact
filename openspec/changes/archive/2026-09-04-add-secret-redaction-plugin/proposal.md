## Why

opencode agents run tool calls (bash, file reads, MCP servers) whose output is
appended directly to the LLM's context and, from there, can end up quoted back
in chat responses, logs, or committed files. When that output happens to
contain a credential — an API key printed by a misconfigured script, a token
embedded in a config file, a password in a database dump — the agent has no
mechanism to catch it before the secret reaches the model and becomes part of
the conversation history. This is a real, unaddressed leak surface: every
other layer of secret-scanning in use today (commit-time `detect-secrets`
hooks, GitHub push protection) fires only once a secret is already in a git
diff. Nothing currently inspects the tool-output stream itself.

## What Changes

- New standalone opencode plugin, `opencode-redact`, that registers the
  `tool.execute.after` hook.
- On every successful tool call, the plugin scans `output.output` (the tool's
  result text) using the `secretlint` JS/TS library (recommend rule preset,
  with the `filter-comments` rule disabled — see Security notes below) and,
  for each finding, replaces exactly the matched substring in place with a
  `***REDACTED:<ruleId>***` placeholder — the rest of the output passes
  through unchanged. Overlapping finding ranges (e.g. a basic-auth match
  nested inside a database-connection-string match) are merged before
  splicing so redaction never produces corrupted or nested placeholders.
- A cheap substring prescreen (checking for a small set of high-signal
  markers such as `-----BEGIN`, `AKIA`, common token prefixes, `://…:…@`)
  runs before the full secretlint pass; only outputs that match the
  prescreen go through the full linter. This bounds the common-case latency
  without introducing a hard size cutoff on what can be scanned. A
  wall-clock timeout wraps the `lintSource` call itself as a second guard
  against pathological/ReDoS input; a timeout is treated the same as a
  scanner error (fail-open — see below).
- Redaction is unconditional (no per-deployment config in v1): the recommend
  preset and the redact-in-place behavior apply to every tool call, with no
  size limit on what gets scanned (bounded instead by the prescreen +
  timeout above).
- Only tool **output** is scanned in v1 (not tool call arguments/`tool.execute.before`).
- When any redaction occurs, the plugin appends a short model-facing note to
  the (redacted) output stating that a secret was redacted and that the
  placeholder must never be written back to a file or repeated verbatim —
  this mitigates the case where a `read`-style tool's redacted output is
  later passed to a `write`/`edit` tool and would otherwise silently
  corrupt the real file content with the placeholder text.
- On a redaction, the plugin logs a warning via `client.app.log` (tool name
  and finding count/rule IDs only — never the secret value or matched
  text). The secretlint call itself is invoked with `maskSecrets: true` so
  that even the underlying finding `message` field never carries the raw
  secret, as defense-in-depth against a future logging change accidentally
  leaking it.
- If scanning itself fails or times out (e.g. a secretlint internal error),
  the plugin logs the failure and passes the original output through
  unmodified — it never blocks or corrupts a tool result due to a scanner
  fault (fail-open on scanner error, not on a genuine finding).
- If the rule preset fails to load at plugin startup, the plugin logs at
  `error` level and re-throws during initialization so the failure is
  visible (opencode's plugin loader reports a load failure rather than the
  session silently running unprotected) instead of failing open with no
  signal.

### Known v1 limitations (explicitly out of scope, not oversights)

These were identified during proposal review and are deliberately deferred,
not silently missed:

- **Failed tool calls are not scanned.** `tool.execute.after` only fires
  after a tool call succeeds; error output (e.g. a command's stderr, a stack
  trace) can still carry a secret to the model unredacted. Addressing this
  would require a different or additional hook and is left for a follow-up
  change.
- **Truncated output can spill an unredacted secret to disk.** opencode
  truncates very large tool output to a managed on-disk retention path
  *before* `tool.execute.after` runs; redacting the in-context string does
  not redact that spill file. A future change would need to intercept
  before truncation or redact the spill path directly.
- **`output.metadata` and `output.attachments` are not scanned** — only
  `output.output`. These are additional fields visible to the model that
  this v1 does not inspect.

## Capabilities

### New Capabilities

- `tool-output-redaction`: scanning tool output for secrets via secretlint and
  redacting matched substrings in place before the output is appended to the
  conversation.

### Modified Capabilities

(none — this is a new, standalone plugin project)

## Impact

- **New repository**: `~/git/opencode-redact/` (local only, no git remote).
- **New runtime dependencies**: `@secretlint/core`, `@secretlint/config-loader`,
  `@secretlint/secretlint-rule-preset-recommend` (all pinned to the verified
  current major, `^13.0.5`). Unlike `opencode-use` (zero runtime
  dependencies), this plugin's own `node_modules` must resolve correctly
  when the plugin file is symlinked into
  `~/.config/opencode/plugins/opencode-redact.js` — this needs to be
  verified during implementation the same way the `opencode-use` peer
  (`@opencode-ai/plugin`) resolution was fixed (see that project's recorded
  fix), since secretlint's own dependency resolver (`@secretlint/resolver`)
  resolves relative to its own package location, not the symlink target.
- **New dev dependency**: `vitest` for the test suite (a deliberate
  divergence from `opencode-use`'s zero-dependency `node:test` setup, given
  the richer assertion/mocking needs of a security-sensitive test matrix).
- **Affected systems**: any opencode session with this plugin installed (via
  file symlink into `~/.config/opencode/plugins/`, matching the `opencode-use`
  convention) will have every successful tool call's output pass through this
  redaction step before the LLM sees it. No existing opencode config or other
  plugin is modified. Plugin hook execution is sequential and in registration
  order, so this plugin's effectiveness relative to another `tool.execute.after`
  plugin (e.g. `opencode-use`) depends on load order — not addressed in v1.
- **Detection is heuristic, not a guarantee.** The recommend rule preset is
  vendor-pattern-based (AWS keys, private key blocks, common token formats,
  etc.) and will not catch bespoke or opaque secret formats (e.g. a plain
  `PASSWORD=hunter2` style value, an internal-format token, a customer
  identifier treated as sensitive). This is a best-effort layer, not a
  substitute for not putting secrets in tool-observable places.
- **Supply chain**: this pulls in the secretlint recommend preset and its
  transitive rule packages into the tool-output path of every session using
  this plugin — normal `npm audit`/lockfile discipline applies, same as any
  other dependency.
- **Testing strategy**: unit tests for the pure redaction function cover, at
  minimum: a known-detectable secret pattern is redacted; clean output is
  untouched; multiple findings in one string are all redacted; overlapping
  findings are merged into one placeholder rather than corrupting output;
  the `secretlint-disable`-style comment embedded in scanned content does
  NOT suppress a finding (since the rule is disabled); a scanner
  error/timeout fails open (original text returned unchanged); empty/
  non-string output is handled without throwing.
- **Distribution/rollback**: installed via a manual file symlink (see
  `opencode-use`'s pattern) — there is no config flag to disable it in v1;
  the fast "turn it off" path is removing the symlink and restarting
  opencode. This is documented in the plugin's README.
