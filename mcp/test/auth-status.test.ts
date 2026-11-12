import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import { authStatus } from "../src/tools/auth_status";
import { writeCredential, writePlans } from "../src/auth/store";

let configDir = "";

beforeEach(() => {
  configDir = mkdtempSync(path.join(os.tmpdir(), "tripdremo-auth-status-"));
  process.env.TRIPDREMO_CONFIG_DIR = configDir;
  process.env.TRIPDREMO_SITE_URL = "https://tripdremo.com";
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  delete process.env.TRIPDREMO_CONFIG_DIR;
  delete process.env.TRIPDREMO_SITE_URL;
});

test("auth_status returns local plan quota for guest identities only", async () => {
  writePlans([
    { share_hash: "abc123", title: "Guest Draft", created_at: new Date().toISOString() },
    { share_hash: "def456", title: "Guest Second", created_at: new Date().toISOString() },
  ]);
  writeCredential({ token: ["cli", "guest", "token"].join("_"), planType: "guest" });

  const status = await authStatus();
  assert.equal(status.kind, "guest");
  assert.equal(status.plans_used, 2);
  assert.equal(status.plans_limit, 1);

  writeCredential({ token: ["cli", "user", "token"].join("_"), planType: "user" });
  const userStatus = await authStatus();
  assert.equal(userStatus.kind, "user");
  assert.equal(userStatus.plans_used, undefined);
  assert.equal(userStatus.plans_limit, 3);
});

test("auth_status treats loopback dev-user mode as an authenticated user", async () => {
  process.env.TRIPDREMO_API_BASE_URL = "http://localhost:8000/api/v1";
  process.env.TRIPDREMO_DEV_USER = "local-smoke";
  try {
    const status = await authStatus();
    assert.equal(status.authenticated, true);
    assert.equal(status.kind, "user");
    assert.equal(status.plans_limit, 3);
  } finally {
    delete process.env.TRIPDREMO_API_BASE_URL;
    delete process.env.TRIPDREMO_DEV_USER;
  }
});
