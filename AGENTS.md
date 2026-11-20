# opencode-redact

opencode plugin that redacts secrets (secretlint plus an entropy rule) from tool output, user prompts and provider requests before they reach the LLM. Fails open on scanner errors; fails loud on startup config errors.

- Runtime: opencode V2 only (`@opencode/plugin`, required peer). Entry `src/plugin.v2.js` is `Plugin.define({ id, setup })`; `src/setup.js` holds the logic and takes a test-only overrides argument. Hooks: `ctx.tool.hook("execute.after")` and `ctx.session.hook` for `prompt`, `context`, `generate`, `compaction`, `title`; one `session.created`, `session.compaction.ended` and `session.deleted` subscription. No tools. No in-band annotations; one steered synthetic disclosure row per session, enqueued on `session.created` (`src/disclosure.js`).
- Layout: `src/` (`plugin.v2.js`, `setup.js`, `redact.js`, `scanner.js` per-session memo, `slicing.js`, `secretlint.js`, `entropy-rule.js`, `prescreen.js`, `structured.js`, `disclosure.js`, `logger.js`, `config.js`), `test/` tests and fixtures (`test/host.js` fake V2 host), `docs/v2-compat-audit.md`, `openspec/specs/` behaviour contracts.
- Test: `npm test` (vitest). No lint or build script. CI: `.github/workflows/ci.yml`. Pre-commit includes detect-secrets (`.secrets.baseline`).
- Usage and configuration: see `README.md`.
