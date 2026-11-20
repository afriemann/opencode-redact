# Tasks

## 1. Location-scoped disclosure

- [x] 1.1 Give the fake host in `test/host.js` a `location` and encode the "A session created in another location gets no row" and "A compaction in a session of another location adds no row" scenarios in `test/disclosure.test.js`; verify both fail first
- [x] 1.2 Update the "A compaction announces a session that predates the plugin" test to fire a request hook first; verify it passes after 1.3
- [x] 1.3 In `src/setup.js`, track own sessions (location match on `session.created`, request hooks, cleared on `session.deleted`) and announce only those; verify `npm test` passes
- [x] 1.4 Confirm the README and `AGENTS.md` wording still matches one row per session; verify with grep
