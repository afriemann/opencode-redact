## 1. Confirm current V1 hook usage

- [x] 1.1 Confirm this plugin's single hook, `tool.execute.after`, and its
  purpose (redacts secrets from tool output via secretlint) from
  `src/index.js` — verify by grepping the source.

## 2. Empirically test against opencode2 (opencode-ai@dev)

- [x] 2.1 In a scratch project, add an `opencode.json` pointing `plugin` at
  this repo's `src/index.js`, run a bash command that outputs a fake
  high-entropy secret via `opencode2 run "..." --print-logs --log-level
  DEBUG`, and capture the log — verify by confirming `opencode-redact`
  log lines appear and the tool output was actually redacted in the
  transcript (not just "no error").
- [x] 2.2 Record the tested `opencode2`/`opencode-ai` dev build version.

## 3. Write the audit document

- [x] 3.1 Write `docs/v2-compat-audit.md` with the same structure as the
  `opencode-use` audit (overview, hook table, empirical results with
  evidence, V2-doc cross-reference, risk rating, reproduction steps).
