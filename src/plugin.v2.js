// opencode-redact, V2 plugin entrypoint (`@opencode/plugin`).

import { Plugin } from "@opencode/plugin";
import { PLUGIN_ID, setup } from "./setup.js";

export default Plugin.define({
  id: PLUGIN_ID,
  setup: (ctx) => setup(ctx),
});
