import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOCOMPLETE_DEFAULTS,
  NEXT_EDIT_DEFAULTS,
  resolveAutocompleteSettings,
  resolveNextEditSettings,
  type ConfigurationReader,
} from "./config";

function reader(values: Record<string, unknown>, section = "autocomplete"): ConfigurationReader {
  return { get: <T>(name: string): T | undefined => (name === section ? (values as T) : undefined) };
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

test("falls back to next-edit defaults when the section is missing", () => {
  const settings = resolveNextEditSettings(undefined);
  assert.deepEqual(settings, NEXT_EDIT_DEFAULTS);
  assert.deepEqual(AUTOCOMPLETE_DEFAULTS.enabled, true);
});

test("clamps next-edit values into their documented ranges", () => {
  const settings = resolveNextEditSettings(reader({
    debounceMs: -5,
    maxTokens: 99999,
    editableLines: 1,
    maxPromptTokens: 1,
    snippetContextLines: 100,
    historyDepth: 99,
    requestTimeoutMs: 10,
  }, "nextEdit"));
  assert.equal(settings.debounceMs, 0);
  assert.equal(settings.maxTokens, 8192);
  assert.equal(settings.editableLines, 5);
  assert.equal(settings.maxPromptTokens, 1024);
  assert.equal(settings.snippetContextLines, 50);
  assert.equal(settings.historyDepth, 10);
  assert.equal(settings.requestTimeoutMs, 1000);
});

test("honors explicit next-edit values", () => {
  const settings = resolveNextEditSettings(reader({
    enabled: false,
    model: " mercury-coder ",
    editableLines: 20,
  }, "nextEdit"));
  assert.equal(settings.enabled, false);
  assert.equal(settings.model, "mercury-coder");
  assert.equal(settings.editableLines, 20);
  assert.equal(settings.debounceMs, NEXT_EDIT_DEFAULTS.debounceMs);
});
