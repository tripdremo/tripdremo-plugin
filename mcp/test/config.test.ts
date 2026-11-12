import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config";

test("locale is constrained to supported values", () => {
  process.env.TRIPDREMO_LOCALE = "fr";
  try {
    assert.throws(() => loadConfig(), /TRIPDREMO_LOCALE must be one of/);
  } finally {
    delete process.env.TRIPDREMO_LOCALE;
  }
});

test("TRIPDREMO_DEV_USER rejected for non-localhost API base", () => {
  process.env.TRIPDREMO_API_BASE_URL = "https://tripdremo.com/api/v1";
  process.env.TRIPDREMO_DEV_USER = "cli-smoke";
  assert.throws(() => loadConfig());
  delete process.env.TRIPDREMO_DEV_USER;
  delete process.env.TRIPDREMO_API_BASE_URL;
});
