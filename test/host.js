// Shared fake V2 host for plugin tests: a ctx exposing exactly what setup()
// touches, stderr capture, and a setup() loader.

import { vi } from "vitest";
import { setup } from "../src/setup.js";

/**
 * A fake V2 ctx. `tool.hook` and `session.hook` capture the callback and
 * resolve to a disposable Registration, matching the real
 * `(name, cb) => Promise<Registration>` shape. `event.subscribe` returns an
 * async iterable fed by `emit`, and ends when its signal aborts.
 */
export function fakeV2Ctx({ options } = {}) {
  const hooks = { "execute.after": null, prompt: null, context: null, generate: null, compaction: null, title: null };
  const disposals = Object.fromEntries(Object.keys(hooks).map((name) => [name, vi.fn().mockResolvedValue(undefined)]));
  const queue = [];
  let wake = null;
  const emit = (event) => {
    queue.push(event);
    wake?.();
  };
  const ctx = {
    app: { name: "opencode", version: "2.0.0-test", channel: "test" },
    options,
    tool: {
      hook: vi.fn(async (name, cb) => {
        hooks[name] = cb;
        return { dispose: disposals[name] };
      }),
    },
    session: {
      hook: vi.fn(async (name, cb) => {
        hooks[name] = cb;
        return { dispose: disposals[name] };
      }),
      synthetic: vi.fn().mockResolvedValue(undefined),
    },
    event: {
      subscribe: vi.fn(({ signal } = {}) => ({
        async *[Symbol.asyncIterator]() {
          while (!signal?.aborted) {
            if (queue.length > 0) {
              yield queue.shift();
              continue;
            }
            await new Promise((resolve) => {
              wake = resolve;
              signal?.addEventListener("abort", resolve, { once: true });
            });
            wake = null;
          }
        },
      })),
    },
  };
  return { ctx, hooks, disposals, emit };
}

export async function loadV2(testOverrides = {}, ctxOptions = {}) {
  const fake = fakeV2Ctx(ctxOptions);
  const cleanup = await setup(fake.ctx, testOverrides);
  return { ...fake, cleanup };
}

/** Captures process.stderr.write for the duration of a callback. */
export async function captureStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    return { result: await fn(), lines };
  } finally {
    process.stderr.write = original;
  }
}

/** Parses captured stderr lines as JSON log entries. */
export function parseLog(lines) {
  return lines.flatMap((line) => line.split("\n").filter(Boolean)).map((line) => JSON.parse(line));
}
