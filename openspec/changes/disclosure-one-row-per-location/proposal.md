# Proposal

## Product intent

Actors: opencode users and the model they talk to. Job: tell the model once per session that redaction is active and that a placeholder is not the real value. Must keep: every session is announced, redaction itself is unaffected by the row. Trust model: the host delivers session events to every loaded plugin instance.

## Why

The host loads the plugin once per location and delivers every session event to each instance, so a new session shows the disclosure row once per loaded location (four times in one observed run).

## What Changes

- Each plugin instance adds the row only for sessions that belong to its own location.
- Ownership is taken from the location carried by `session.created`, and for sessions it did not see created, from its request hooks having fired for that session.

## Capabilities

### Modified Capabilities
- `redaction-disclosure`: the row is added by one instance per session; the compaction-for-unseen-session scenario requires the session to have been seen by this instance's request hooks.

## Impact

`src/setup.js`, `test/host.js`, `test/disclosure.test.js`, `openspec/specs/redaction-disclosure/spec.md`.
