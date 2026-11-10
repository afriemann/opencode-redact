## Why

LLM provider tool-call IDs (`toolu_bdrk_…`, `toolu_vrtx_…`, `toolu_01…`, `call_…`) look high-entropy and are redacted, which breaks tools that take such an ID as an argument. The plugin must not know any tool by name, so the fix is a shape-based exemption.

## What Changes

- Exempt a candidate run that is entirely an Anthropic-style (`toolu_`, `toolu_bdrk_`, `toolu_vrtx_`) or OpenAI-style (`call_`) tool-call ID from high-entropy detection.
- The exemption applies to whole runs only; a secret glued to an ID is still reported.

## Impact

- `src/entropy-rule.js` (allowlist), `openspec/specs/high-entropy-secret-detection/spec.md`, `test/entropy-rule.test.js`.
- Residual risk: a secret deliberately formatted as `toolu_<20-40 alphanumerics>` or `call_<20-40 alphanumerics>` passes the entropy rule; secretlint rules are unaffected.
