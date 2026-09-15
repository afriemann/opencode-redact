# opencode V2 Compatibility Audit — `opencode-redact`

**Date:** 2026-09-15
**Tested against:** `opencode-ai@dev` (`0.0.0-dev-202609142154`), via the
`opencode2` sandbox command. See the shared
`reality/opencode-v2-sandbox-plugin-compat` memory atom and `opencode-use`'s
`docs/v2-compat-audit.md` for the general V2 background and methodology —
not repeated in full here.

**Note on hook discovery:** this repo's primary local checkout
(`~/git/opencode-redact`) was stale relative to `origin/main` (62 lines vs.
166) — the local branch had not been pulled since a `chat.message` hook was
added alongside the original `tool.execute.after` hook. The worktree used
for this audit was created fresh from `origin/main` and has the current
2-hook version; the primary checkout should be fast-forwarded separately.

## What "opencode V2" is

See `opencode-use`'s audit doc for the full background. In short: V2
(`packages/core`, Effect-based) is merged incrementally into the same
`opencode-ai` package, tracked via prerelease dist-tags. `opencode debug v2`
confirms V2 is live today only for the catalog domain — the V1 plugin
runtime (hooks used here) is unaffected so far.

## Hooks registered by this plugin (`src/index.js`, current `origin/main`)

| Hook | Purpose |
|---|---|
| `tool.execute.after` | Scans tool output for secrets (via secretlint) and redacts them before they reach the LLM |
| `chat.message` | Scans non-synthetic text parts of a newly received user message for secrets and redacts them in place, before the message is processed |

## Empirical test result

**Setup:** scratch project (`/tmp/opencode/v2-sandbox/test-redact`) with
`opencode.json` pointing `plugin` at this repo's `src/index.js` (worktree,
unmodified, current `origin/main` content).

**Methodological finding:** a secret typed directly in the CLI prompt (even
split across string-concatenation, base64, or `chr()`-code obfuscation) is
caught by `chat.message` *before* the tool ever runs — so `tool.execute.after`
cannot be exercised by a secret present anywhere in the literal prompt text.
To get positive evidence for `tool.execute.after` specifically, the secret
had to be generated **inside** the tool execution itself, with zero
high-entropy substring in the prompt:

```
opencode2 run "Use the bash tool to run exactly: python3 -c \"import secrets; print(secrets.token_hex(24))\"" \
  --auto --print-logs --log-level DEBUG
```

(`--auto` was needed because non-interactive `opencode run` auto-rejects any
bash permission prompt not already covered by an allow-listed pattern —
`python3 -c "..."` isn't pre-allowed, unlike `echo *`.)

**Result — both hooks fired with direct positive evidence:**

| Hook | Result | Evidence |
|---|---|---|
| `chat.message` | ✅ Pass (direct evidence) | Multiple runs where a secret-shaped string was typed in the prompt produced: `message="redacted 1 secret(s) across user message parts (rules: high-entropy)"` (exact match to the hook's own log format, `src/index.js:150`), followed by the model correctly reporting it received a `***REDACTED:...***` placeholder instead of the real value |
| `tool.execute.after` | ✅ Pass (direct evidence) | The `secrets.token_hex(24)` run produced: `message="redacted 1 secret(s) in tool 'bash' output (rules: high-entropy)"` (exact match to `src/index.js:66`), and the model's final response confirmed the tool output was redacted rather than showing the raw token |

No `opencode-redact` errors were logged in any run. The only unrelated
failure observed was the already-known
`~/.config/opencode/plugins/opencode-openspec.js` load failure
(`command.trim is not a function`), tracked in that repo's own audit.

## Cross-reference against the documented V2 plugin API

V2's plugin API (`packages/plugin/src/v2/{effect,promise}/README.md`)
documents only `agent`/`catalog`/`command`/`integration`/`reference`/`skill`
`.transform()` hooks and `aisdk.sdk`/`aisdk.language` runtime hooks. There is
no documented V2 equivalent for `tool.execute.after` or `chat.message`.
Empirically, both still work today on the V1 plugin runtime.

## Risk rating and recommended action

Risk = likelihood × impact of this hook breaking on a future V2 migration.

| Hook | Risk | Recommended action |
|---|---|---|
| `tool.execute.after` | Medium-High | Core mechanism for redacting leaked secrets in tool output. No V2-documented equivalent. Highest-priority hook to re-test on every `dev` bump — a silent failure here means secrets reach the LLM/logs unredacted with no error surfaced. |
| `chat.message` | Medium-High | Same criticality — protects against secrets typed directly by the user. No V2-documented equivalent. Re-test on every `dev` bump alongside `tool.execute.after`. |

**Overall:** No action needed today — both hooks work correctly against the
current `dev` prerelease, with direct positive evidence for each. Given the
security-relevant nature of this plugin (a silent break here has real data-
exposure consequences, unlike a purely functional plugin), re-test this pair
of hooks on every `dev`/`beta` refresh, not just periodically.

## How to reproduce this test

```bash
cd ~/opencode-v2-sandbox && npm install opencode-ai@dev && node node_modules/opencode-ai/postinstall.mjs
opencode2 --version

mkdir -p /tmp/opencode-redact-v2-test && cd /tmp/opencode-redact-v2-test
cat > opencode.json << 'EOF'
{ "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-redact/src/index.js"] }
EOF

# chat.message: type a secret-shaped string directly
opencode2 run "echo test-value ghp_1234567890abcdefghijklmnopqrstuvwxyzAB" \  # pragma: allowlist secret
  --print-logs --log-level DEBUG 2>&1 | grep -iE "opencode-redact|redacted"

# tool.execute.after: secret must be generated inside the tool, not typed
opencode2 run "Use the bash tool to run exactly: python3 -c \"import secrets; print(secrets.token_hex(24))\"" \
  --auto --print-logs --log-level DEBUG 2>&1 | grep -iE "opencode-redact|redacted"
```
