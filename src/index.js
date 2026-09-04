import { createSecretlintConfig, createLinter } from "./secretlint.js";
import { redactSecrets } from "./redact.js";

/**
 * opencode plugin that redacts secrets from tool output before it reaches
 * the LLM. Registers the `tool.execute.after` hook. See proposal.md and
 * design.md for the full behavior contract.
 *
 * `@opencode-ai/plugin` is referenced only through erased JSDoc types below
 * (never a runtime import) — see design.md D7 for why no peer-dependency
 * symlink is needed for this plugin, unlike opencode-use.
 *
 * @param {{ client: import("@opencode-ai/plugin").PluginInput["client"] }} input
 * @param {{ _createSecretlintConfigOverride?: () => Promise<unknown> }} [testOverrides]
 *   Internal test seam only — never used by opencode itself.
 */
export default async function OpencodeRedact({ client }, testOverrides = {}) {
  const loadConfig = testOverrides._createSecretlintConfigOverride ?? createSecretlintConfig;

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    await logSafely(client, "error", `failed to load secretlint rule configuration: ${err?.message ?? err}`);
    throw err;
  }

  const lint = createLinter(config);

  return {
    "tool.execute.after": async (input, output) => {
      try {
        const original = output.output;
        if (typeof original !== "string" || original.length === 0) {
          return;
        }

        const { text, redactionCount, ruleIds } = await redactSecrets(original, { lint });
        if (redactionCount === 0) {
          return;
        }

        output.output = text;
        await logSafely(
          client,
          "warn",
          `redacted ${redactionCount} secret(s) in tool '${input.tool}' output (rules: ${ruleIds.join("+")})`,
        );
      } catch (err) {
        await logSafely(client, "error", `redaction handler failed for tool '${input?.tool}': ${err?.message}`);
      }
    },
  };
}

async function logSafely(client, level, message) {
  try {
    await client.app.log({ body: { service: "opencode-redact", level, message } });
  } catch {
    // Logging is best-effort; never let a logging failure escalate.
  }
}
