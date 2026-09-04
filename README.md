# opencode-redact

An [opencode](https://github.com/anomalyco/opencode) plugin that scans the
text returned by every successful tool call for secrets and redacts them in
place — before that output is appended to the LLM's context.

## What it does

- Registers the `tool.execute.after` hook.
- Scans `output.output` using [secretlint](https://github.com/secretlint/secretlint)'s
  recommend rule preset (with the `filter-comments` rule disabled — see
  "Known limitations" below).
- Replaces each detected secret with a `***REDACTED:<rule>***` placeholder,
  merging overlapping findings and expanding to whitespace boundaries so a
  finding whose reported range only partially covers its secret doesn't leave
  a fragment of it in the output.
- Appends a short note telling the model a redaction occurred and that it must
  never write a placeholder back into a file, command, or message.
- Logs a warning (tool name, redaction count, rule ids only — never the
  matched secret text or scanner message) when a redaction happens.
- **Fails open** on a scanner error or timeout — the original output passes
  through unmodified rather than being blocked or corrupted.
- **Fails loud** at plugin startup if the secretlint rule configuration cannot
  load — this is the one point where a failure is not silent.

See `openspec/changes/add-secret-redaction-plugin/` (or, once archived,
`openspec/specs/tool-output-redaction/spec.md`) for the full behavior
contract, and `design.md` for the implementation rationale.

## Install

```bash
npm install
```

Then symlink the entry file into opencode's plugin directory:

```bash
ln -s "$(pwd)/src/index.js" ~/.config/opencode/plugins/opencode-redact.js
```

Restart opencode. No further configuration is needed — there is no config
file in v1 (see "Known limitations").

Unlike some other plugins with a peer dependency on `@opencode-ai/plugin`,
this plugin needs no additional symlink step for its own dependencies — a
plain `npm install` inside this repo is sufficient. `@opencode-ai/plugin` is
referenced only through erased JSDoc types, never imported at runtime.

## Rollback / disabling

There is no config flag to turn this off in v1. The fast "turn it off" path
is removing the symlink and restarting opencode:

```bash
rm ~/.config/opencode/plugins/opencode-redact.js
```

## Known limitations (v1, documented — not oversights)

- **Failed tool calls are not scanned.** `tool.execute.after` only fires
  after a tool call succeeds; error output (e.g. a command's stderr, a stack
  trace) can still carry a secret to the model unredacted.
- **Truncated output can spill an unredacted secret to disk.** opencode
  truncates very large tool output to a managed on-disk retention path
  *before* this hook runs; redacting the in-context string does not redact
  that spill file.
- **`output.metadata` and `output.attachments` are not scanned** — only
  `output.output`.
- **The GCP p12 (binary) check never fires.** The GCP rule only runs when
  the scanned content's extension is `.json` or `.p12`; this plugin detects
  JSON-shaped text automatically and scans it as `.json`, but `.p12` is a
  binary format with no text-based fixture that could route a text-only
  pipeline into that branch.
- **AWS access-key-id and account-id detection is not active.** Those two
  checks in the AWS rule are gated behind an `enableIDScanRule` option that
  defaults to `false` and is not set by this plugin — only the AWS
  secret-access-key check is reachable. (Access key IDs alone are not
  secrets, so this is by design, not a gap.)
- **Detection is heuristic, not a guarantee.** The recommend preset is
  vendor-pattern-based and will not catch bespoke or opaque secret formats.
- **Over-redaction is possible** on dense, single-line content (e.g.
  minified JSON) — a finding there expands to the whole line. This is the
  safe direction for a security control, and the annotation warns the model
  not to write the placeholder back.
- **No config surface of any kind** — no config file, no environment
  variable, no per-rule enable/disable, no allowlist.
- **Hook ordering relative to other `tool.execute.after` plugins is
  undefined** — opencode runs hooks sequentially in registration order.

## Development

```bash
npm test
```

Tests use [vitest](https://vitest.dev). `test/fixtures.js` contains one
verified-real fixture per reachable secretlint rule, derived empirically by
probing the installed rule bundle rather than invented from documentation —
see `design.md` D2 for why the fixture list, not hand-derivation, is the
source of truth.
