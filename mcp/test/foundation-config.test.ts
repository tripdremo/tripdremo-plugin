import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config";

test("foundation config supplies documented defaults", () => {
  assert.deepEqual(loadConfig({}), {
    apiBaseUrl: "https://tripdremo.com/api/v1",
    siteUrl: "https://tripdremo.com",
    locale: "en",
    configDir: path.join(os.homedir(), ".tripdremo"),
    devUser: undefined,
    timeoutMs: 30_000,
    submitTimeoutMs: 300_000,
    logLevel: "warn",
  });
});

test("foundation config validates URLs, enums, timeout, and config path strictly", () => {
  assert.throws(() => loadConfig({ TRIPDREMO_API_BASE_URL: "/api/v1" }), /absolute URL/);
  assert.throws(() => loadConfig({ TRIPDREMO_SITE_URL: "ftp://tripdremo.com" }), /HTTP\(S\)/);
  assert.throws(() => loadConfig({ TRIPDREMO_LOCALE: "fr" }), /TRIPDREMO_LOCALE/);
  assert.throws(() => loadConfig({ TRIPDREMO_LOG_LEVEL: "verbose" }), /TRIPDREMO_LOG_LEVEL/);
  assert.throws(() => loadConfig({ TRIPDREMO_TIMEOUT_MS: "12ms" }), /positive integer/);
  assert.throws(() => loadConfig({ TRIPDREMO_SUBMIT_TIMEOUT_MS: "0" }), /TRIPDREMO_SUBMIT_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ TRIPDREMO_CONFIG_DIR: "relative" }), /absolute path/);
});

test("foundation config keeps the plan-submission timeout separate and configurable", () => {
  const configured = loadConfig({ TRIPDREMO_TIMEOUT_MS: "1000", TRIPDREMO_SUBMIT_TIMEOUT_MS: "90000" });
  assert.equal(configured.timeoutMs, 1_000);
  assert.equal(configured.submitTimeoutMs, 90_000);
});

test("foundation config permits dev user only on loopback API URLs", () => {
  assert.equal(loadConfig({
    TRIPDREMO_API_BASE_URL: "http://127.0.0.1:8000/api/v1/",
    TRIPDREMO_DEV_USER: "cli-smoke",
  }).apiBaseUrl, "http://127.0.0.1:8000/api/v1");
  assert.equal(loadConfig({
    TRIPDREMO_API_BASE_URL: "http://[::1]:8000/api/v1",
    TRIPDREMO_DEV_USER: "cli-smoke",
  }).devUser, "cli-smoke");
  assert.throws(() => loadConfig({
    TRIPDREMO_API_BASE_URL: "https://tripdremo.com/api/v1",
    TRIPDREMO_DEV_USER: "cli-smoke",
  }), /localhost/);
});
