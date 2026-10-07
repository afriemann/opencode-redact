# opencode-redact

opencode plugin that redacts secrets (secretlint plus an entropy rule) from tool output and user messages before they reach the LLM. Fails open on scanner errors; fails loud on startup config errors.

- Runtimes: V1 (`@opencode-ai/plugin`) via `src/plugin.v1.js` (package `main`), V2 (`@opencode/plugin`) via `src/plugin.v2.js`. V1 hooks: `tool.execute.after`, `chat.message`. V2: `ctx.tool.hook("execute.after")` and `ctx.session.hook` for `prompt`, `context`, `generate`, `compaction`. No tools.
- Layout: `src/` (`redact.js`, `secretlint.js`, `entropy-rule.js`, `prescreen.js`, `config.js`), `test/` tests and fixtures, `scripts/generate-redact-baseline.mjs`, `docs/v2-compat-audit.md`, `openspec/specs/` behaviour contracts.
- Test: `npm test` (vitest). No lint or build script. CI: `.github/workflows/ci.yml`. Pre-commit includes detect-secrets (`.secrets.baseline`).
- Usage and configuration: see `README.md`.
