import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import type { ApiClient } from "../src/api/client.js";
import { startLogin, waitForLogin } from "../src/auth/device.js";
import { TripdremoError } from "../src/errors.js";
import {
  appendPlan,
  currentSubmissionIdentityHash,
  deleteCredential,
  ensureDeviceId,
  readCredential,
  readPendingSubmission,
  readPlans,
  redactedToken,
  setAuthMeta,
  setToken,
  PENDING_SUBMISSION_MAX_AGE_MS,
  writeCredential,
  writePendingSubmission,
  writePlans,
} from "../src/auth/store.js";
import { logout } from "../src/tools/logout.js";

let configDir = "";
const token = () => ["cli", "test", "secret", "last"].join("_");

beforeEach(() => {
  configDir = mkdtempSync(path.join(os.tmpdir(), "tripdremo-auth-store-"));
  process.env.TRIPDREMO_CONFIG_DIR = configDir;
  process.env.TRIPDREMO_LOCALE = "lt";
});

afterEach(() => {
  delete process.env.TRIPDREMO_CONFIG_DIR;
  delete process.env.TRIPDREMO_LOCALE;
  rmSync(configDir, { recursive: true, force: true });
});

test("device identity is stable, separate from credentials, and files are hardened", () => {
  const first = ensureDeviceId();
  chmodSync(configDir, 0o755);
  writeCredential({ token: token(), planType: "guest" });
  const second = ensureDeviceId();

  assert.equal(second, first);
  assert.equal(readCredential().deviceId, first);
  assert.equal(statSync(configDir).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(configDir, "device.json")).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(configDir, "credentials.json")).mode & 0o777, 0o600);
  assert.equal(readFileSync(path.join(configDir, "device.json"), "utf8").includes("token"), false);
});

test("logout deletes credentials but preserves stable device identity and plans", async () => {
  const deviceId = ensureDeviceId();
  writeCredential({ token: token(), planType: "guest" });
  writePendingSubmission({
    submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    payload_hash: "a".repeat(64),
    identity_hash: currentSubmissionIdentityHash(),
    created_at: new Date().toISOString(),
  });
  writePlans([{ share_hash: "abc123", title: "Sample", created_at: new Date().toISOString() }]);
  let revokeCalls = 0;
  const result = await logout({}, {
    request: async () => {
      revokeCalls += 1;
      assert.equal(readCredential().token, token());
      throw new Error("offline");
    },
  } as unknown as ApiClient);

  assert.deepEqual(result, { ok: true, remote_revoked: false });
  assert.equal(revokeCalls, 1);
  assert.equal(existsSync(path.join(configDir, "credentials.json")), false);
  assert.equal(existsSync(path.join(configDir, "pending-revocation.json")), true);
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), false);
  assert.equal(statSync(path.join(configDir, "pending-revocation.json")).mode & 0o777, 0o600);
  assert.equal(ensureDeviceId(), deviceId);
  assert.equal((await readPlans()).length, 1);
  assert.equal(existsSync(path.join(configDir, "device.json")), true);
});

test("guest-to-user approval preserves pending replay while token rotation clears it", () => {
  writeCredential({ token: token(), planType: "guest" });
  const guestIdentity = currentSubmissionIdentityHash();
  writePendingSubmission({
    submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    payload_hash: "a".repeat(64),
    identity_hash: guestIdentity,
    created_at: new Date().toISOString(),
  });

  setAuthMeta({ planType: "user", email: "approved@example.com" });
  assert.equal(currentSubmissionIdentityHash(), guestIdentity);
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), true);

  writeCredential({ token: ["cli", "rotated", "credential", "last"].join("_"), planType: "user" });
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), false);
});

test("expired pending submission metadata is deleted after the bounded replay age", () => {
  writeCredential({ token: token(), planType: "guest" });
  const identityHash = currentSubmissionIdentityHash();
  const createdAt = Date.parse("2026-08-17T00:00:00.000Z");
  writePendingSubmission({
    submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    payload_hash: "a".repeat(64),
    identity_hash: identityHash,
    created_at: new Date(createdAt).toISOString(),
  });
  assert.ok(readPendingSubmission(identityHash, createdAt + PENDING_SUBMISSION_MAX_AGE_MS), "the exact max-age boundary remains replayable");
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), true);
  assert.equal(readPendingSubmission(identityHash, createdAt + PENDING_SUBMISSION_MAX_AGE_MS + 1), undefined);
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), false);
});

test("missing and corrupt credentials are logged out without replacing the device", () => {
  const deviceId = ensureDeviceId();
  writeFileSync(path.join(configDir, "credentials.json"), "not-json");
  assert.deepEqual(readCredential(), { deviceId });
  writeFileSync(path.join(configDir, "credentials.json"), "x".repeat(65 * 1024));
  assert.deepEqual(readCredential(), { deviceId });
});

test("store refuses symlink writes and oversized device identity files", () => {
  const outside = path.join(configDir, "outside.json");
  writeFileSync(outside, "{}");
  symlinkSync(outside, path.join(configDir, "credentials.json"));
  assert.throws(() => writeCredential({ token: token() }), /symlink/i);
  rmSync(path.join(configDir, "credentials.json"));
  symlinkSync(outside, path.join(configDir, "pending-submission.json"));
  assert.throws(() => writePendingSubmission({
    submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    payload_hash: "a".repeat(64),
    identity_hash: "b".repeat(64),
    created_at: new Date().toISOString(),
  }), /symlink/i);
  rmSync(path.join(configDir, "pending-submission.json"));
  writeFileSync(path.join(configDir, "device.json"), "x".repeat(5 * 1024));
  assert.throws(() => ensureDeviceId(), /too large/i);
});

test("startLogin uses the anonymous endpoint, stores the secret, and returns no token", async () => {
  const calls: Array<{ route: string; body: unknown }> = [];
  const client = {
    request: async () => { throw new Error("authenticated request must not be used"); },
    requestAnonymous: async (_method: string, route: string, body: unknown) => {
      calls.push({ route, body });
      return {
        cli_token: token(),
        device_code: "device_xyz",
        user_code: "ABCD-12",
        verification_uri: "https://tripdremo.com/lt/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=ABCD-12",
        expires_in: 300,
        interval: 5,
      };
    },
  } as unknown as ApiClient;

  const result = await startLogin(client, false);
  const credential = readCredential();
  assert.equal("token" in result, false);
  assert.equal(credential.token, token());
  assert.equal(credential.planType, "guest");
  assert.equal(credential.login?.device_code, "device_xyz");
  assert.equal(calls[0]?.route, "/cli/auth/device/");
  assert.deepEqual(calls[0]?.body, { device_id: credential.deviceId, locale: "lt" });
});

test("new guest provisioning rejects a response without a CLI credential", async () => {
  const client = {
    requestAnonymous: async () => ({
      device_code: "device-missing-token",
      user_code: "MISS-12",
      verification_uri: "https://tripdremo.com/lt/cli/authorize",
      verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=MISS-12",
      expires_in: 300,
      interval: 5,
    }),
  } as unknown as ApiClient;

  await assert.rejects(() => startLogin(client, false), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "internal");
    return true;
  });
  assert.equal(existsSync(path.join(configDir, "credentials.json")), false);
});

test("startLogin reuses an unexpired code and refreshes an expired code with the current bearer", async () => {
  activeLogin(new Date().toISOString(), 5, 300);
  let anonymousCalls = 0;
  let authenticatedCalls = 0;
  const refreshedPayload = {
    device_code: "device-new",
    user_code: "NEW-12",
    verification_uri: "https://tripdremo.com/lt/cli/authorize",
    verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=NEW-12",
    expires_in: 300,
    interval: 5,
  };
  const client = {
    requestAnonymous: async () => {
      anonymousCalls += 1;
      return refreshedPayload;
    },
    request: async () => {
      authenticatedCalls += 1;
      assert.equal(readCredential().token, token());
      return refreshedPayload;
    },
  } as unknown as ApiClient;
  const reused = await startLogin(client, false);
  assert.equal(reused.user_code, "ABCD-12");
  assert.equal(anonymousCalls, 0);
  assert.equal(authenticatedCalls, 0);

  setAuthMeta({
    login: {
      ...readCredential().login!,
      started_at: new Date(Date.now() - 10_000).toISOString(),
      expires_in: 1,
    },
  });
  const refreshed = await startLogin(client, false);
  assert.equal(refreshed.user_code, "NEW-12");
  assert.equal(authenticatedCalls, 1);
  assert.equal(anonymousCalls, 0);
  assert.equal(readCredential().login?.device_code, "device-new");
});

test("user device rotation stays user through pending and explicit approval", async () => {
  writeCredential({ token: token(), planType: "user", email: "before@example.com" });
  let pollStatus: "pending" | "approved" = "pending";
  const client = {
    request: async (_method: string, route: string) => {
      assert.equal(route, "/cli/auth/device/");
      return {
        device_code: "device-user-rotate",
        user_code: "USER-12",
        verification_uri: "https://tripdremo.com/lt/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=USER-12",
        expires_in: 300,
        interval: 1,
      };
    },
    requestAnonymous: async (_method: string, route: string) => {
      assert.equal(route, "/cli/auth/token/");
      return pollStatus === "pending"
        ? { status: "pending" }
        : { status: "approved", email: "after@example.com" };
    },
  } as unknown as ApiClient;

  await startLogin(client, false);
  assert.equal(readCredential().planType, "user");
  assert.equal(readCredential().token, token());
  setAuthMeta({ login: { ...readCredential().login!, started_at: new Date(Date.now() - 5_000).toISOString() } });
  assert.deepEqual(await waitForLogin(client, 0), { status: "pending" });
  assert.equal(readCredential().planType, "user");
  pollStatus = "approved";
  const approved = await waitForLogin(client, 0);
  assert.equal(approved.status, "approved");
  assert.equal(readCredential().planType, "user");
  assert.equal(readCredential().email, "after@example.com");
});

test("startLogin falls back to anonymous reprovisioning after a revoked bearer", async () => {
  const deviceId = ensureDeviceId();
  setToken(token(), "guest");
  let authenticatedCalls = 0;
  let anonymousCalls = 0;
  const result = await startLogin({
    request: async () => {
      authenticatedCalls += 1;
      throw new TripdremoError("not_authenticated", "revoked");
    },
    requestAnonymous: async (_method: string, route: string, body: unknown) => {
      anonymousCalls += 1;
      assert.equal(route, "/cli/auth/device/");
      assert.deepEqual(body, { device_id: deviceId, locale: "lt" });
      return {
        cli_token: ["cli", "reprovisioned", "last"].join("_"),
        device_code: "device-reprovisioned",
        user_code: "NEW-34",
        verification_uri: "https://tripdremo.com/lt/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=NEW-34",
        expires_in: 300,
        interval: 5,
      };
    },
  } as unknown as ApiClient, false);
  assert.equal(result.user_code, "NEW-34");
  assert.equal(authenticatedCalls, 1);
  assert.equal(anonymousCalls, 1);
  assert.equal(readCredential().deviceId, deviceId);
});

test("a logged-out device reprovisions anonymously with its persistent device id", async () => {
  const deviceId = ensureDeviceId();
  setToken(token(), "guest");
  deleteCredential();
  let authenticatedCalls = 0;
  let anonymousCalls = 0;
  await startLogin({
    request: async () => {
      authenticatedCalls += 1;
      throw new Error("no bearer should be attempted");
    },
    requestAnonymous: async (_method: string, _route: string, body: unknown) => {
      anonymousCalls += 1;
      assert.deepEqual(body, { device_id: deviceId, locale: "lt" });
      return {
        cli_token: ["cli", "after", "logout", "last"].join("_"),
        device_code: "device-after-logout",
        user_code: "OUT-12",
        verification_uri: "https://tripdremo.com/lt/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=OUT-12",
        expires_in: 300,
        interval: 5,
      };
    },
  } as unknown as ApiClient, false);
  assert.equal(authenticatedCalls, 0);
  assert.equal(anonymousCalls, 1);
  assert.equal(readCredential().deviceId, deviceId);
});

test("failed logout tombstone is used only to revoke before anonymous reprovision", async () => {
  const deviceId = ensureDeviceId();
  setToken(token(), "guest");
  const client = {
    request: async () => { throw new Error("offline during logout"); },
  } as unknown as ApiClient;
  await logout({}, client);
  assert.equal(existsSync(path.join(configDir, "credentials.json")), false);
  assert.equal(existsSync(path.join(configDir, "pending-revocation.json")), true);

  let tombstoneRevokeCalls = 0;
  let anonymousCalls = 0;
  const result = await startLogin({
    request: async () => { throw new Error("ordinary authenticated request must not be used"); },
    requestWithToken: async (_method: string, route: string, _body: unknown, explicitToken: string) => {
      tombstoneRevokeCalls += 1;
      assert.equal(route, "/cli/auth/revoke/");
      assert.equal(explicitToken, token());
      return {};
    },
    requestAnonymous: async (_method: string, route: string, body: unknown) => {
      anonymousCalls += 1;
      assert.equal(route, "/cli/auth/device/");
      assert.deepEqual(body, { device_id: deviceId, locale: "lt" });
      return {
        cli_token: ["cli", "new", "guest", "last"].join("_"),
        device_code: "device-new-guest",
        user_code: "NEW-56",
        verification_uri: "https://tripdremo.com/lt/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=NEW-56",
        expires_in: 300,
        interval: 5,
      };
    },
  } as unknown as ApiClient, false);
  assert.equal(tombstoneRevokeCalls, 1);
  assert.equal(anonymousCalls, 1);
  assert.equal(existsSync(path.join(configDir, "pending-revocation.json")), false);
  assert.equal(JSON.stringify(result).includes(token()), false);
});

test("a second logout retries a failed revocation tombstone instead of discarding it", async () => {
  setToken(token(), "guest");
  await logout({}, {
    request: async () => { throw new Error("first revoke offline"); },
  } as unknown as ApiClient);
  assert.equal(existsSync(path.join(configDir, "credentials.json")), false);
  assert.equal(existsSync(path.join(configDir, "pending-revocation.json")), true);

  let explicitCalls = 0;
  const second = await logout({}, {
    request: async () => { throw new Error("no active credential should be used"); },
    requestWithToken: async (_method: string, route: string, _body: unknown, explicitToken: string) => {
      explicitCalls += 1;
      assert.equal(route, "/cli/auth/revoke/");
      assert.equal(explicitToken, token());
      return {};
    },
  } as unknown as ApiClient);
  assert.deepEqual(second, { ok: true, remote_revoked: true });
  assert.equal(explicitCalls, 1);
  assert.equal(existsSync(path.join(configDir, "pending-revocation.json")), false);
  assert.equal(existsSync(path.join(configDir, "credentials.json")), false);
});

function activeLogin(startedAt: string, interval = 2, expiresIn = 300) {
  setToken(token(), "guest");
  setAuthMeta({
    planType: "guest",
    login: {
      device_code: "device_xyz",
      user_code: "ABCD-12",
      verification_uri: "https://tripdremo.com/en/cli/authorize",
      verification_uri_complete: "https://tripdremo.com/en/cli/authorize?code=ABCD-12",
      interval,
      expires_in: expiresIn,
      started_at: startedAt,
    },
  });
}

test("waitForLogin polls anonymously and promotes an approved identity", async () => {
  activeLogin(new Date(Date.now() - 10_000).toISOString());
  let anonymousCalls = 0;
  const client = {
    request: async () => { throw new Error("authenticated request must not be used"); },
    requestAnonymous: async (_method: string, route: string, body: unknown) => {
      anonymousCalls += 1;
      assert.equal(route, "/cli/auth/token/");
      assert.deepEqual(body, { device_code: "device_xyz" });
      return { status: "approved", email: "user@example.com", claimed_plans: [{ share_hash: "ab12", title: "Dolomites" }] };
    },
  } as unknown as ApiClient;

  const result = await waitForLogin(client, 0);
  assert.equal(result.status, "approved");
  assert.equal(anonymousCalls, 1);
  assert.equal(readCredential().planType, "user");
  assert.equal(readCredential().login, null);
});

test("waitForLogin respects the polling interval and reports pending without a request", async () => {
  activeLogin(new Date().toISOString(), 5);
  let calls = 0;
  const result = await waitForLogin({
    requestAnonymous: async () => { calls += 1; return { status: "pending" }; },
  } as unknown as ApiClient, 0);
  assert.deepEqual(result, { status: "pending" });
  assert.equal(calls, 0);
  assert.notEqual(readCredential().login, null);
});

test("waitForLogin reports local and server expiry and clears active login metadata", async () => {
  activeLogin(new Date(Date.now() - 10 * 60 * 1000).toISOString(), 2, 300);
  let calls = 0;
  assert.deepEqual(await waitForLogin({ requestAnonymous: async () => { calls += 1; return {}; } } as unknown as ApiClient, 0), { status: "expired" });
  assert.equal(calls, 0);
  assert.equal(readCredential().login, null);

  activeLogin(new Date(Date.now() - 10_000).toISOString());
  assert.deepEqual(await waitForLogin({ requestAnonymous: async () => ({ status: "expired" }) } as unknown as ApiClient, 0), { status: "expired" });
  assert.equal(readCredential().login, null);
});

test("an expired user reauthorization code preserves the existing user session", async () => {
  activeLogin(new Date(Date.now() - 10 * 60 * 1000).toISOString(), 2, 300);
  setAuthMeta({ planType: "user" });
  const result = await waitForLogin({
    requestAnonymous: async () => { throw new Error("expired code must not be polled"); },
  } as unknown as ApiClient, 0);
  assert.deepEqual(result, { status: "expired" });
  assert.equal(readCredential().planType, "user");
  assert.equal(readCredential().login, null);
  assert.equal(readCredential().token, token());
});

test("token redaction retains only the CLI prefix and last four characters", () => {
  assert.equal(redactedToken(token()), "cli_…last");
  assert.equal(redactedToken().includes(token()), false);
});

test("appendPlan deduplicates by share hash", async () => {
  writePlans([
    { share_hash: "ab", title: "A", created_at: new Date().toISOString() },
    { share_hash: "cd", title: "B", created_at: new Date().toISOString() },
  ]);
  appendPlan({ share_hash: "ab", title: "A updated" });
  const result = await readPlans();
  assert.equal(result.length, 2);
  assert.equal(result[0]?.title, "A updated");
});
