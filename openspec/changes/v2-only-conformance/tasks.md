# Tasks

## 1. V1 removal and entry

- [x] 1.1 Delete `src/plugin.v1.js` and `test/index.test.js`, port the entropy end-to-end cases to the V2 tests; `npm test` passes
- [x] 1.2 Update `package.json` (`main`/`.` to V2, no `./v1`, no `@opencode-ai/plugin`, required `@opencode/plugin` peer); `npm ci` succeeds
- [x] 1.3 Move setup into `src/setup.js` and export `Plugin.define({id, setup})` as the only export of `src/plugin.v2.js`; conformance tests pass

## 2. Disclosure row and annotations

- [x] 2.1 Remove `buildAnnotation` and `buildUserMessageAnnotation` and every append site; scenarios under "Redact Secrets In Re-Derived Message History" and "Redact Detected Secrets In User Messages" pass
- [x] 2.2 Add the per-session row ("Announce Redaction With One Visible Row Per Session", "Disclosure Row Carries Placeholder Guidance", "Disclosure Failure Must Not Affect Redaction"); its scenarios pass
- [x] 2.3 Emit one debug audit entry per edit ("Audit Every Edit"); the scenario passes

## 3. Scan performance and stability

- [x] 3.1 Make `scanAndRedact` report completion explicitly; "A Failed Scan Is Never Treated As Clean" passes
- [x] 3.2 Replace span lookups in `src/entropy-rule.js` with a sorted sweep; the 200 KB scan drops below 1 s
- [x] 3.3 Slice and yield in the scan path; "Scans Must Not Block The Host Event Loop" and "Slicing Must Not Miss A Boundary-Straddling Secret" pass
- [x] 3.4 Drop the character-budget skip; "A very long string leaf is still scanned" passes
- [x] 3.5 Add the per-session memo; "Repeated Redaction Is Stable Within A Session" passes

## 4. Options and logging

- [x] 4.1 Read `ctx.options` tighten-only; "Plugin Options May Only Tighten Settings" scenarios pass
- [x] 4.2 Log one JSON line with `service`, variable data in `extra`, error class or code only, `info` on init and options, `debug` on skips; verified by running the plugin and reading stderr

## 5. Docs and CI

- [x] 5.1 Make README, AGENTS.md, `docs/v2-compat-audit.md`, `src/config.js` comments and the `high-entropy-secret-detection` purpose V2-only, with the channel disclosure; grep for `v1`, `annotat` and `chat.message` finds none
- [x] 5.2 Pin `actions/setup-node` by SHA and set the Node matrix to `22.5` and `24` in `.github/workflows/ci.yml`; the workflow file validates
