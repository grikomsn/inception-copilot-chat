import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("declares native API-key configuration without a management-command override", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { languageModelChatProviders: Array<Record<string, unknown>> };
  };
  const provider = manifest.contributes.languageModelChatProviders.find((item) => item.vendor === "inception");
  assert.ok(provider);
  assert.equal(provider.managementCommand, undefined);
  const configuration = provider.configuration as {
    required?: string[];
    properties?: Record<string, { secret?: boolean }>;
  };
  assert.deepEqual(configuration.required, ["apiKey"]);
  assert.equal(configuration.properties?.apiKey.secret, true);
});

test("keeps the legacy management commands available for the Secret Storage key", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { commands: Array<{ command: string; title: string }> };
  };
  assert.match(
    manifest.contributes.commands.find((item) => item.command === "inceptionCopilot.testConnection")?.title ?? "",
    /Test Inference/,
  );
  assert.ok(manifest.contributes.commands.some((item) => item.command === "inceptionCopilot.manage"));
});

test("exposes usage commands and the status bar setting", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: {
      commands: Array<{ command: string; title: string }>;
      configuration: { properties: Record<string, { default?: unknown } > };
    };
  };
  assert.ok(manifest.contributes.commands.some((item) => item.command === "inceptionCopilot.showUsage"));
  assert.ok(manifest.contributes.commands.some((item) => item.command === "inceptionCopilot.openUsage"));
  assert.ok(manifest.contributes.commands.some((item) => item.command === "inceptionCopilot.completionMenu"));
  const setting = manifest.contributes.configuration.properties["inceptionCopilot.showUsageStatusBar"];
  assert.ok(setting, "showUsageStatusBar setting must be declared");
  assert.equal(setting.default, true);
});
