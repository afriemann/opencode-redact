// spec: openspec/specs/scan-performance/spec.md
import { describe, it, expect, vi } from "vitest";
import { createScanner } from "../src/scanner.js";

const SECRET = "secret-value-123";

/** A stub linter flagging every occurrence of SECRET. */
function stubLint() {
  return vi.fn(async (text) => {
    const messages = [];
    let from = 0;
    for (;;) {
      const at = text.indexOf(SECRET, from);
      if (at < 0) break;
      messages.push({ ruleId: "stub", range: [at, at + SECRET.length] });
      from = at + SECRET.length;
    }
    return messages;
  });
}

describe("createScanner", () => {
  it("Identical input redacts identically", async () => {
    const lint = stubLint();
    const scanner = createScanner({ lint });
    const first = await scanner.scan(`token ${SECRET}`, { sessionID: "s1" });
    const second = await scanner.scan(`token ${SECRET}`, { sessionID: "s1" });
    expect(second).toEqual(first);
    expect(first.text).toContain("***REDACTED:");
    expect(lint).toHaveBeenCalledTimes(1);
  });

  it("reuses a completed clean scan", async () => {
    const lint = stubLint();
    const scanner = createScanner({ lint });
    const first = await scanner.scan("nothing here", { sessionID: "s1" });
    const second = await scanner.scan("nothing here", { sessionID: "s1" });
    expect(first).toMatchObject({ text: "nothing here", redactionCount: 0, ok: true });
    expect(second).toEqual(first);
    expect(lint).toHaveBeenCalledTimes(1);
  });

  it("A timed-out scan is retried", async () => {
    const lint = stubLint();
    lint.mockRejectedValueOnce(new Error("timed out"));
    const scanner = createScanner({ lint });
    const failed = await scanner.scan(`token ${SECRET}`, { sessionID: "s1" });
    expect(failed).toMatchObject({ ok: false, redactionCount: 0 });
    const retried = await scanner.scan(`token ${SECRET}`, { sessionID: "s1" });
    expect(retried.ok).toBe(true);
    expect(retried.text).toContain("***REDACTED:");
  });

  it("does not reuse a scan the linter reported as incomplete", async () => {
    const lint = vi.fn(async () => Object.assign([], { incomplete: true }));
    const scanner = createScanner({ lint });
    await scanner.scan("abc", { sessionID: "s1" });
    await scanner.scan("abc", { sessionID: "s1" });
    expect(lint).toHaveBeenCalledTimes(2);
  });

  it("keeps the fence exemption flag in the memo key", async () => {
    const lint = stubLint();
    const scanner = createScanner({ lint });
    const fenced = `\`\`\`noredact\n${SECRET}\n\`\`\``;
    const exempt = await scanner.scan(fenced, { sessionID: "s1", honorNoRedact: true });
    const scanned = await scanner.scan(fenced, { sessionID: "s1", honorNoRedact: false });
    expect(exempt.text).toBe(fenced);
    expect(scanned.text).toContain("***REDACTED:");
  });

  it("keeps sessions apart and forgets a deleted session", async () => {
    const lint = stubLint();
    const scanner = createScanner({ lint });
    await scanner.scan("same", { sessionID: "a" });
    await scanner.scan("same", { sessionID: "b" });
    expect(lint).toHaveBeenCalledTimes(2);
    scanner.forget("a");
    await scanner.scan("same", { sessionID: "a" });
    expect(lint).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight scan between concurrent callers", async () => {
    const lint = stubLint();
    const scanner = createScanner({ lint });
    const [a, b] = await Promise.all([
      scanner.scan(`x ${SECRET}`, { sessionID: "s1" }),
      scanner.scan(`x ${SECRET}`, { sessionID: "s1" }),
    ]);
    expect(a).toEqual(b);
    expect(lint).toHaveBeenCalledTimes(1);
  });

  it("scans without memo when no session is known", async () => {
    const lint = stubLint();
    const scanner = createScanner({ lint });
    await scanner.scan("same", {});
    await scanner.scan("same", {});
    expect(lint).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entries beyond its bounds", async () => {
    const lint = stubLint();
    const scanner = createScanner({ lint, maxEntries: 2 });
    for (const text of ["one", "two", "three"]) await scanner.scan(text, { sessionID: "s1" });
    await scanner.scan("three", { sessionID: "s1" });
    expect(lint).toHaveBeenCalledTimes(3);
    await scanner.scan("one", { sessionID: "s1" });
    expect(lint).toHaveBeenCalledTimes(4);
  });

  it("warns once per session when a scan is incomplete, without text", async () => {
    const lint = vi.fn(async () => {
      throw new Error(`boom ${SECRET}`);
    });
    const log = vi.fn();
    const scanner = createScanner({ lint, log });
    await scanner.scan(`a ${SECRET}`, { sessionID: "s1" });
    await scanner.scan(`b ${SECRET}`, { sessionID: "s1" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });
});
