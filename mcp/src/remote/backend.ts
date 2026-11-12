import { TripdremoError } from "../errors.js";
import { isTripdremoErrorCode, parseJsonSafely, redactSensitive } from "../tools/helpers.js";
import { VERSION } from "../version.js";
import { MCP_RESOURCE, type RemoteConfig } from "./config.js";

export class RemoteAuthError extends Error {
  constructor(readonly status: 401 | 403 | 503, readonly code: "invalid_token" | "insufficient_scope" | "temporarily_unavailable") {
    super(code);
  }
}

export type RemoteIdentity = { subject: string; clientId: string; scopes: string[]; expiresAt: number };

export async function introspectToken(token: string, config: RemoteConfig): Promise<RemoteIdentity> {
  let raw: Record<string, unknown>;
  try {
    const response = await fetch(`${config.backendBaseUrl}/oauth/internal/token-check/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tripdremo-Gateway": config.gatewaySecret },
      body: JSON.stringify({ token }),
      redirect: "error",
      signal: AbortSignal.timeout(config.introspectionTimeoutMs),
    });
    if (!response.ok) throw new RemoteAuthError(503, "temporarily_unavailable");
    raw = parseJsonSafely(await response.json());
  } catch {
    // Fail closed without exposing backend errors or the submitted token.
    throw new RemoteAuthError(503, "temporarily_unavailable");
  }
  const expiresAt = typeof raw.expires_at === "number" ? raw.expires_at * 1000 : NaN;
  if (raw.active !== true || raw.audience !== MCP_RESOURCE || typeof raw.subject !== "string" || !raw.subject || typeof raw.client_id !== "string" || !raw.client_id || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new RemoteAuthError(401, "invalid_token");
  }
  if (!Array.isArray(raw.scopes) || !raw.scopes.every((scope) => typeof scope === "string")) {
    throw new RemoteAuthError(403, "insufficient_scope");
  }
  return { subject: raw.subject, clientId: raw.client_id, scopes: raw.scopes, expiresAt };
}

const ADAPTER_PATH = /^\/mcp\/(?:auth-status\/|schema\/|submissions\/(?:prepare\/|[0-9a-f-]{36}\/)?|plans\/(?:[A-Za-z0-9_-]+\/)?)$/;

/** One delegated credential per HTTP request; never imports the local identity store. */
export class RemoteBackend {
  constructor(private readonly token: string, private readonly config: RemoteConfig) {}

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
    const url = new URL(`${this.config.backendBaseUrl}${path}`);
    const relativePath = url.pathname.slice(new URL(this.config.backendBaseUrl).pathname.length);
    if (!ADAPTER_PATH.test(relativePath) || url.origin !== new URL(this.config.backendBaseUrl).origin) {
      throw new TripdremoError("invalid_request", "Unsupported Tripdremo adapter path.");
    }
    let response: Response;
    let raw: Record<string, unknown>;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "X-Tripdremo-Gateway": this.config.gatewaySecret,
          "Content-Type": "application/json",
          "User-Agent": `tripdremo-mcp/${VERSION} (+https://tripdremo.com)`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(this.config.backendTimeoutMs),
      });
      raw = parseJsonSafely(await response.json());
    } catch {
      throw new TripdremoError("backend_unreachable", "Tripdremo did not return a result. Check submission status before retrying a write.", {
        retryable: true, details: { reason: "unknown_outcome" },
      });
    }
    const safe = redactSensitive(raw) as Record<string, unknown>;
    if (response.ok || (response.status === 422 && safe.status === "needs_revision")) return safe;
    const error = typeof safe.error === "object" && safe.error !== null ? safe.error as Record<string, unknown> : safe;
    const code = isTripdremoErrorCode(error.code) ? error.code
      : response.status === 401 || response.status === 403 ? "not_authenticated"
        : response.status === 404 ? "plan_not_found"
          : response.status === 429 ? "rate_limited"
            : response.status >= 500 ? "backend_unreachable" : "invalid_request";
    throw new TripdremoError(code, typeof error.message === "string" ? error.message : typeof error.detail === "string" ? error.detail : "Tripdremo could not complete this operation.", {
      retryable: error.retryable === true || response.status >= 500 || response.status === 429,
      details: {
        ...(typeof error.details === "object" && error.details !== null ? error.details : {}),
        ...(typeof error.code === "string" ? { code: error.code } : {}),
        http_status: response.status,
      },
    });
  }
}
