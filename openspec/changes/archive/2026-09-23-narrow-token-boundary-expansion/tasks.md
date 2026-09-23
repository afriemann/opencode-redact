# Tasks

## 1. Red step — failing tests

- [x] 1.1 Add a failing test in `test/redact.test.js` for "stops expansion at a
      structural delimiter in dense JSON" (scenario title matches the spec)
      and verify it fails against the current `expandToTokenBoundaries`
      implementation.
- [x] 1.2 Confirm existing whitespace-boundary tests in `test/redact.test.js`
      still describe the intended behavior unchanged (no edits needed unless
      a case now needs updating), and verify the full suite still fails only
      on the new test.

## 2. Implementation

- [x] 2.1 Extend `expandToTokenBoundaries` in `src/redact.js` so the boundary
      test matches whitespace OR one of `" ' \` , { } [ ]`, with a code
      comment documenting the verified-invariant dependency on secretlint
      rules reporting complete ranges (per proposal.md's security-review
      disposition) so a future secretlint/preset-recommend version bump
      re-triggers scrutiny of this assumption. Verify all tests in
      `test/redact.test.js` pass, including the new one from 1.1.
- [x] 2.2 Run the full test suite (`npm test`) and verify it passes with no
      regressions.

## 3. Docs and spec sync

- [x] 3.1 Update README's "Over-redaction is possible on dense, single-line
      content" known-limitation note to describe the narrowed (not
      eliminated) blast radius, and verify the note accurately reflects the
      new behavior.
- [x] 3.2 Confirm `openspec/changes/narrow-token-boundary-expansion/specs/tool-output-redaction/spec.md`
      matches what was actually implemented (sync check) and verify
      `openspec validate narrow-token-boundary-expansion` passes.

## 4. Verification and review

- [x] 4.1 Perform the mandatory self-review-for-simplification pass on the
      diff (duplication, code smells, overengineering, redundant comments)
      and verify each finding is fixed inline or documented as intentional.
- [x] 4.2 Get the change reviewed by `code-reviewer` and `security`; verify
      every `[BLOCKER]` is resolved and every `[WARNING]` has a documented
      disposition.
