import assert from "node:assert/strict";
import test from "node:test";
import { resolveAutocompleteSettings, type ConfigurationReader } from "./config";

function reader(values: Record<string, unknown>): ConfigurationReader {
  return { get: <T>(section: string): T | undefined => (section === "autocomplete" ? (values as T) : undefined) };
}

test("falls back to defaults when the section is missing", () => {
  const settings = resolveAutocompleteSettings(undefined);
  assert.deepEqual(settings, {
    enabled: true,
    model: "mercury-edit-2",
    debounceMs: 100,
    maxTokens: 256,
    maxPromptTokens: 8192,
    requestTimeoutMs: 5000,
  });
});

test("clamps numeric values into their documented ranges", () => {
  const settings = resolveAutocompleteSettings(reader({
    debounceMs: 9999,
    maxTokens: 1,
    maxPromptTokens: 100000,
    requestTimeoutMs: 0,
  }));
  assert.equal(settings.debounceMs, 2000);
  assert.equal(settings.maxTokens, 16);
  assert.equal(settings.maxPromptTokens, 32000);
  assert.equal(settings.requestTimeoutMs, 500);
});

test("honors explicit values and the disabled flag", () => {
  const settings = resolveAutocompleteSettings(reader({
    enabled: false,
    model: " mercury-edit-2 ",
    debounceMs: 0,
    maxTokens: 512,
  }));
  assert.equal(settings.enabled, false);
  assert.equal(settings.model, "mercury-edit-2");
  assert.equal(settings.debounceMs, 0);
  assert.equal(settings.maxTokens, 512);
});

test("ignores invalid types", () => {
  const settings = resolveAutocompleteSettings(reader({
    enabled: "yes",
    model: 42,
    debounceMs: "fast",
  }));
  assert.equal(settings.enabled, true);
  assert.equal(settings.model, "mercury-edit-2");
  assert.equal(settings.debounceMs, 100);
});
