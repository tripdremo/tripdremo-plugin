import { spawn } from "node:child_process";
import { ApiClient } from "../api/client.js";
import { loadConfig } from "../config.js";
import { TripdremoError } from "../errors.js";
import {
  deletePendingRevocation,
  ensureDeviceId,
  readCredential,
  readPendingRevocation,
  setAuthMeta,
  writeCredential,
} from "./store.js";

export type LoginStartResponse = {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type LoginWaitResult =
  | { status: "approved"; email?: string; claimed_plans?: Array<{ share_hash: string; title: string }> }
  | { status: "pending" }
  | { status: "expired" };

type DevicePayload = LoginStartResponse & {
  cli_token?: string;
  device_code: string;
};

function openVerificationPage(rawUrl: string): void {
  try {
    const target = new URL(rawUrl);
    if ((target.protocol !== "https:" && target.protocol !== "http:") || target.username || target.password) return;
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const child = spawn(command, [target.toString()], { detached: true, stdio: "ignore", shell: false });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Browser opening is best effort; the caller still receives the URL.
  }
}

export async function startLogin(client: ApiClient, openBrowser: boolean = true): Promise<LoginStartResponse> {
  const credential = readCredential();
  const existing = credential.login;
  if (existing) {
    const startedAt = Date.parse(existing.started_at);
    const expiresAt = startedAt + existing.expires_in * 1000;
    if (Number.isFinite(expiresAt) && Date.now() < expiresAt) {
      const verification = {
        user_code: existing.user_code,
        verification_uri: existing.verification_uri,
        verification_uri_complete: existing.verification_uri_complete,
        expires_in: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
        interval: existing.interval,
      };
      if (openBrowser) openVerificationPage(existing.verification_uri_complete);
      return verification;
    }
  }
  const payload = {
    device_id: ensureDeviceId(),
    locale: loadConfig().locale,
  };
  const pendingRevocation = readPendingRevocation();
  if (!credential.token && pendingRevocation) {
    try {
      await client.requestWithToken("post", "/cli/auth/revoke/", {}, pendingRevocation);
      deletePendingRevocation();
    } catch (error) {
      if (!(error instanceof TripdremoError) || error.code !== "not_authenticated") throw error;
      deletePendingRevocation();
    }
  }
  let response: DevicePayload;
  if (credential.token) {
    try {
      response = await client.request<DevicePayload>("post", "/cli/auth/device/", payload);
    } catch (error) {
      if (!(error instanceof TripdremoError) || error.code !== "not_authenticated") throw error;
      response = await client.requestAnonymous<DevicePayload>("post", "/cli/auth/device/", payload);
    }
  } else {
    response = await client.requestAnonymous<DevicePayload>("post", "/cli/auth/device/", payload);
  }
  const responseToken = response.cli_token ?? credential.token;
  if (!responseToken) {
    throw new TripdremoError("internal", "Tripdremo did not return a credential for the new CLI identity.");
  }
  writeCredential({
    token: responseToken,
    planType: credential.planType ?? "guest",
    userCode: response.user_code,
    login: {
      device_code: response.device_code,
      user_code: response.user_code,
      verification_uri: response.verification_uri,
      verification_uri_complete: response.verification_uri_complete,
      interval: response.interval,
      expires_in: response.expires_in,
      started_at: new Date().toISOString(),
    },
  });

  const verification = {
    user_code: response.user_code,
    verification_uri: response.verification_uri,
    verification_uri_complete: response.verification_uri_complete,
    expires_in: response.expires_in,
    interval: response.interval,
  };
  if (openBrowser) openVerificationPage(response.verification_uri_complete);
  return verification;
}

export async function waitForLogin(client: ApiClient, timeoutSeconds = 120): Promise<LoginWaitResult> {
  const startedWaitingAt = Date.now();
  const deadline = startedWaitingAt + Math.max(0, Math.min(timeoutSeconds, 300)) * 1000;
  const credential = readCredential();
  const login = credential.login;
  const existingPlanType = credential.planType ?? "guest";
  if (!login?.device_code) throw new TripdremoError("invalid_request", "No active login flow found. Run tripdremo_login_start first.");

  const intervalMs = Math.max(1, Math.min(login.interval, 30)) * 1000;
  const loginStartedAt = Date.parse(login.started_at);
  const expiresAt = loginStartedAt + Math.max(0, login.expires_in) * 1000;
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    setAuthMeta({ planType: existingPlanType, login: null });
    return { status: "expired" };
  }
  let nextPollAt = loginStartedAt + intervalMs;
  let immediatePollDue = nextPollAt <= startedWaitingAt;

  while ((immediatePollDue || Date.now() <= deadline) && Date.now() < expiresAt) {
    const waitMs = Math.min(nextPollAt - Date.now(), deadline - Date.now(), expiresAt - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    if (Date.now() < nextPollAt || (!immediatePollDue && Date.now() > deadline)) break;
    if (Date.now() >= expiresAt) {
      setAuthMeta({ planType: existingPlanType, login: null });
      return { status: "expired" };
    }

    immediatePollDue = false;
    const next = await client.requestAnonymous<{
      status: string;
      email?: string;
      claimed_plans?: Array<{ share_hash: string; title: string }>;
    }>("post", "/cli/auth/token/", { device_code: login.device_code });
    if (next.status === "approved") {
      setAuthMeta({
        ...(next.email ? { email: next.email } : {}),
        planType: "user",
        login: null,
      });
      return {
        status: "approved",
        ...(next.email ? { email: next.email } : {}),
        ...(next.claimed_plans ? { claimed_plans: next.claimed_plans } : {}),
      };
    }
    if (next.status === "expired") {
      setAuthMeta({ planType: existingPlanType, login: null });
      return { status: "expired" };
    }
    nextPollAt = Date.now() + intervalMs;
  }

  if (Date.now() >= expiresAt) {
    setAuthMeta({ planType: existingPlanType, login: null });
    return { status: "expired" };
  }
  return { status: "pending" };
}

export function resolveVerificationUri(verificationUri: string, locale = "en") {
  return {
    verification_uri: verificationUri,
    verification_uri_complete: verificationUri.includes("code=") ? verificationUri : `${verificationUri}?code=${locale}`,
  };
}
