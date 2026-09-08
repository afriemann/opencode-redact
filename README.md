# opencode-redact

An [opencode](https://github.com/anomalyco/opencode) plugin that scans the
text returned by every successful tool call for secrets and redacts them in
place — before that output is appended to the LLM's context.

## What it does

This plugin registers two hooks. **Tool output** (`tool.execute.after`,
described here) is scanned unconditionally; **user messages** are scanned by
a separate hook with a narrower scope and its own exemption mechanism — see
"User message redaction" below.

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

<img width="1453" height="657" alt="image" src="https://github.com/user-attachments/assets/ad1235e2-dfd8-4c25-9f6a-db7fc8ec1182" />

See `openspec/specs/tool-output-redaction/spec.md` for the full tool-output
behavior contract and `openspec/specs/user-message-redaction/spec.md` for the
user-message contract; see each change's `design.md` for implementation
rationale.

## User message redaction

- Registers the `chat.message` hook, which fires when a new message is
  received — before it reaches the LLM.
- **Scope: non-synthetic text parts only.** Only parts where
  `type === "text" && synthetic !== true` are scanned. This deliberately
  excludes `@`-mentioned file bodies, directory listings, decoded pastes, and
  subagent/task-tool prompts — all of these arrive as *synthetic* parts, not
  text the user typed into the composer themselves. Scanning that content is
  out of scope for v1 (see "Known limitations"); it is unscanned today too, so
  this is not a regression.
- Each qualifying part is redacted independently using the same detect →
  merge → splice pipeline as tool output (`***REDACTED:<rule>***`
  placeholders, merged overlapping findings, token-boundary expansion).
- **The ` ```noredact ` fence** lets you exempt part of your own message from
  scanning — useful for sending a checksum, hash, or other string that only
  *looks* like a secret. Wrap it in a fenced code block whose info string is
  exactly `noredact` (case-insensitive):

  ````
  ```noredact
  0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd
  ```
  ````

  Rules of this fence (this plugin's own grammar — not full Markdown, and not
  CommonMark-conformant in every respect):
  - The opening line is 0–3 leading spaces, 3 or more backticks, then the word
    `noredact` (case-insensitive) and nothing else besides surrounding
    whitespace.
  - The closing line must have **exactly** the same number of backticks as
    the opener — not "at least", as CommonMark specifies. A 4-backtick opener
    closed by a 3- or 5-backtick line is **not** closed.
  - Only backticks are recognised; a `~~~noredact` block is ordinary text and
    **is** scanned.
  - **No nesting.** The first line with a matching bare backtick run of the
    right length closes the block — so a plain ` ``` ` line *inside* a
    3-backtick `noredact` block ends it early, and everything after that is
    scanned normally. If your content itself contains a bare ` ``` ` line,
    wrap it with a **longer** fence instead (e.g. ` ````noredact ` … ` ```` `),
    which is exempt from the nesting problem precisely because the closer
    must match the opener's exact length.
  - A malformed or unterminated fence is **not** exempt — see "Known
    limitations".
  - This fence is honored **only** in user messages, never in tool output.
- Exactly **one** annotation is appended per message (to the last part that
  was actually redacted), aggregating the count and rule ids across every
  redacted part — not one annotation per part. The wording is deliberately
  different from the tool-output annotation: it tells the model the
  redaction happened in the user's own message and instructs it to say so and
  stop rather than try to recover the value (unlike the tool-output note,
  which says to ask the user for it — here the user already supplied it, and
  it was redacted on purpose). **The annotation never mentions the
  `noredact` fence or how it works** — this is intentional: `chat.message`
  also fires for subagent/task-tool turns, where the "user message" is
  authored by the parent model, so teaching the fence to the model would
  teach it a documented way to bypass this security control.
- Logs a warning (redaction count, rule ids only — never message text) when a
  redaction happens.
- **Fails open**, and **never rejects**, even on an unexpected internal
  error — a rejection from this hook would abort the user's entire turn, not
  just skip redaction, so failures here are always swallowed and logged
  rather than propagated.

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
- **Live streaming preview is not redacted.** opencode's `bash` tool
  (`src/tool/shell.ts`) streams stdout chunk-by-chunk into a live preview
  field (`ctx.metadata({ metadata: { output: ... } })`) as the command runs,
  and this is what a human watching the TUI in real time sees — entirely
  separate from, and populated *before*, the final `tool.execute.after`
  hook this plugin uses. Confirmed by direct testing (2026-09-04): a
  previously-unseen randomly generated secret, read back through `cat`,
  never reached the model (only `***REDACTED:aws***` was ever visible in
  the conversation/tool-result history — the value the LLM provider
  actually receives), but the live terminal-style rendering in the TUI can
  still show raw output while a command is executing. **This is a
  human-visible-only gap, not a model/provider leak** — the redaction
  guarantee this plugin makes (secrets don't reach the LLM or persist in
  replayed conversation history) still holds; only a live-updating visual
  preview during execution is unaffected.
- **Synthetic content in a user turn is not scanned.** `@`-mentioned file
  bodies, directory listings, decoded pastes, and subagent/task-tool prompts
  all arrive as *synthetic* parts and are out of scope for the
  `chat.message` hook (see "User message redaction" above) — a secret
  pasted via one of those paths is not redacted. This is unscanned today
  too (no regression); scanning it is deferred to a future change.
- **A malformed or unterminated `noredact` fence fails safe by being
  scanned, not exempted.** If you open a fence and never close it, or close
  it with the wrong number of backticks, that content is treated as
  ordinary text and scanned like anything else — it is never silently
  dropped from scanning by a broken fence.
- **Segment-splitting can suppress the GCP JSON-key detection.** The GCP
  rule only fires when the *scanned segment* parses as JSON
  (`JSON.parse` succeeds). If a `noredact` fence splits a pasted JSON blob
  into multiple segments, no single segment may parse as valid JSON on its
  own, and the GCP rule then never fires on that message — even though the
  same content pasted as tool output, or as a user message with no fence in
  it, would be caught. This is a narrower case of a pre-existing gap: any
  prose+JSON mix already fails to parse as JSON today.
- **Possible TUI optimistic-render gap for user messages, analogous to the
  tool-output streaming-preview limitation above.** Some TUI clients may
  render the user's just-typed message optimistically before this hook's
  redacted version returns over the session event stream, similar to the
  bash live-preview gap. This has not yet been empirically confirmed (unlike
  the tool-output case, which was directly tested) — treat it as a
  suspected, not verified, human-visible-only gap until confirmed.

## Development

```bash
npm test
```

Tests use [vitest](https://vitest.dev). `test/fixtures.js` contains one
verified-real fixture per reachable secretlint rule, derived empirically by
probing the installed rule bundle rather than invented from documentation —
see `design.md` D2 for why the fixture list, not hand-derivation, is the
source of truth.
