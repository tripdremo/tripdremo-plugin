import { VERSION } from "../version.js";
import { loadConfig, type TripdremoConfig } from "../config.js";
import { TripdremoError } from "../errors.js";
import { getToken } from "../auth/store.js";
import { redactSensitive } from "../tools/helpers.js";

export type ApiResponse<T> = { status: number; headers: Headers; body: T };
export type HttpMethod = "get" | "post" | "put" | "delete";
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  version?: string;
  config?: TripdremoConfig;
  fetch?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  tokenProvider?: () => string | undefined;
};

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;
const MAX_RETRY_DELAY_MS = 30_000;

export class ApiClient {
  private readonly config: TripdremoConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly tokenProvider: () => string | undefined;
  private readonly userAgent: string;

  constructor(versionOrOptions: string | ApiClientOptions = VERSION) {
    const options = typeof versionOrOptions === "string" ? { version: versionOrOptions } : versionOrOptions;
    this.config = options.config ?? loadConfig();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.tokenProvider = options.tokenProvider ?? getToken;
    this.userAgent = `tripdremo-mcp/${options.version ?? VERSION} (+https://tripdremo.com)`;
  }

  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    return (await this.requestWithRetry<T>(method, path, body)).body;
  }

  async requestAnonymous<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    return (await this.requestWithRetryMode<T>(method, path, body, false)).body;
  }

  async requestWithToken<T>(method: HttpMethod, path: string, body: unknown, token: string): Promise<T> {
    return (await this.requestWithRetryMode<T>(method, path, body, false, token)).body;
  }

  async requestWithRetry<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.requestWithRetryMode(method, path, body, true);
  }

  async requestPlanSubmission<T = unknown>(body: unknown): Promise<ApiResponse<T>> {
    return this.requestWithRetryMode(
      "post",
      "/trips/agent-submit/",
      body,
      true,
      undefined,
      [422],
      this.config.submitTimeoutMs,
      false,
    );
  }

  private async requestWithRetryMode<T>(
    method: HttpMethod,
    path: string,
    body: unknown,
    includeIdentity: boolean,
    explicitToken?: string,
    allowedStatuses: readonly number[] = [],
    requestTimeoutMs: number = this.config.timeoutMs,
    retryHttpFailures: boolean = true,
  ): Promise<ApiResponse<T>> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: ApiResponse<unknown>;
      try {
        response = await this.fetchOnce(method, path, body, includeIdentity, explicitToken, requestTimeoutMs);
      } catch (error) {
        // A network timeout does not prove that the server failed before applying
        // a write. Retrying here can duplicate plan-generation work, so only
        // explicit HTTP 429/5xx responses enter the retry loop below.
        throw error;
      }

      if ((response.status >= 200 && response.status < 300) || allowedStatuses.includes(response.status)) {
        return response as ApiResponse<T>;
      }
      if (
        response.status === 503
        && typeof response.body === "object"
        && response.body !== null
        && !Array.isArray(response.body)
        && path === "/trips/agent-generate/"
        && (response.body as { code?: unknown }).code === "backend_ai_disabled"
      ) {
        this.throwMappedError(response.status, response.headers, response.body, method, path);
      }
      if (retryHttpFailures && (response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
        const retryAfter = response.headers.get("Retry-After");
        const retryDelay = this.retryDelay(retryAfter, attempt);
        // Never retry earlier than Retry-After. Excessive server-requested waits
        // fail immediately instead of tying up an MCP tool call indefinitely.
        if (retryAfter && retryDelay > Math.min(MAX_RETRY_DELAY_MS, requestTimeoutMs)) {
          this.throwMappedError(response.status, response.headers, response.body, method, path);
        }
        await this.sleep(retryDelay);
        continue;
      }
      this.throwMappedError(response.status, response.headers, response.body, method, path);
    }
    throw new TripdremoError("internal", "API retry loop ended unexpectedly");
  }

  async rawRequest(method: "post", path: string, body?: unknown): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(method, path, body);
  }

  private headers(includeIdentity: boolean, explicitToken?: string): Headers {
    const headers = new Headers({
      "Content-Type": "application/json",
      "User-Agent": this.userAgent,
    });
    if (explicitToken) {
      headers.set("Authorization", `Bearer ${explicitToken}`);
    } else if (includeIdentity && this.config.devUser) {
      headers.set("X-Travel-User", this.config.devUser);
    } else if (includeIdentity) {
      const token = this.tokenProvider();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }
    return headers;
  }

  private async fetchOnce(
    method: HttpMethod,
    path: string,
    body: unknown,
    includeIdentity: boolean,
    explicitToken?: string,
    requestTimeoutMs: number = this.config.timeoutMs,
  ): Promise<ApiResponse<unknown>> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const init: RequestInit = {
        method: method.toUpperCase(),
        headers: this.headers(includeIdentity, explicitToken),
        signal: controller.signal,
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const response = await this.fetchImpl(`${this.config.apiBaseUrl}${normalizedPath}`, init);
      return { status: response.status, headers: response.headers, body: await this.parseBody(response) };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      throw new TripdremoError("backend_unreachable", timedOut ? "Tripdremo API request timed out." : "Tripdremo API is unreachable.", {
        retryable: true,
        details: {
          api_base_url: this.config.apiBaseUrl,
          reason: timedOut ? "timeout" : "network_error",
          ...(timedOut ? { timeout_ms: requestTimeoutMs } : {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private retryDelay(retryAfter: string | null, attempt: number): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.max(0, date - this.now());
    }
    return this.backoff(attempt);
  }

  private backoff(attempt: number): number {
    const exponential = BASE_BACKOFF_MS * (2 ** attempt);
    return exponential + Math.floor(this.random() * BASE_BACKOFF_MS);
  }

  private errorDetails(status: number, method: HttpMethod, path: string, body: unknown): Record<string, unknown> {
    const context = { status, method: method.toUpperCase(), path };
    const redacted = redactSensitive(body);
    return typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)
      ? { ...context, ...(redacted as Record<string, unknown>) }
      : { ...context, response_body: redacted };
  }

  private throwMappedError(status: number, headers: Headers, body: unknown, method: HttpMethod, path: string): never {
    const retryAfter = headers.get("Retry-After");
    const details = {
      ...this.errorDetails(status, method, path, body),
      ...(retryAfter ? { retry_after: retryAfter } : {}),
    };
    if (status === 400) throw new TripdremoError("invalid_request", "Tripdremo rejected the request fields.", { details });
    if (status === 409 && (details as Record<string, unknown>).code === "generation_in_progress") {
      throw new TripdremoError("invalid_request", "A Tripdremo generation is already in progress for this account.", {
        retryable: true,
        details,
      });
    }
    if (status === 409 && path === "/trips/agent-submit/" && (details as Record<string, unknown>).code === "submission_in_progress") {
      throw new TripdremoError("invalid_request", "This Tripdremo plan submission is still being processed.", {
        retryable: true,
        details,
      });
    }
    if (status === 409 && path === "/trips/agent-submit/" && (details as Record<string, unknown>).code === "idempotency_conflict") {
      throw new TripdremoError("invalid_request", "The submission identifier was already used for different plan content.", {
        details,
      });
    }
    if (status === 401) throw new TripdremoError("not_authenticated", "Tripdremo authentication is required.", { details });
    if (status === 403) throw new TripdremoError("quota_exceeded", "The Tripdremo plan quota has been reached.", { details });
    if (status === 404) throw new TripdremoError("plan_not_found", "The requested Tripdremo plan was not found.", { details });
    if (status === 409 && (details as Record<string, unknown>).code === "identity_changed") {
      throw new TripdremoError("invalid_request", "Tripdremo identity changed while the request was starting. Retry the request.", {
        retryable: true,
        details,
      });
    }
    if (status === 429) {
      throw new TripdremoError("rate_limited", "Tripdremo rate limited the request.", {
        retryable: true,
        details,
      });
    }
    if (status === 503 && path === "/trips/agent-generate/" && (details as Record<string, unknown>).code === "backend_ai_disabled") {
      throw new TripdremoError(
        "backend_ai_disabled",
        "Tripdremo backend AI generation is disabled. Author the plan locally with tripdremo_get_plan_schema, then submit it with tripdremo_submit_plan.",
        { details },
      );
    }
    if (status === 502 && /\/trips\/(?:generate|agent-generate)\/?(?:\?|$)/.test(path)) {
      const reason = typeof (details as { detail?: unknown }).detail === "string" ? (details as { detail: string }).detail : "Trip generation failed.";
      throw new TripdremoError("generation_failed", "Trip generation failed.", { details: { ...details, reason } });
    }
    if (status >= 500) {
      throw new TripdremoError("backend_unreachable", "The Tripdremo API request failed.", {
        retryable: true,
        details: { ...details, api_base_url: this.config.apiBaseUrl },
      });
    }
    throw new TripdremoError("internal", "Tripdremo returned an unexpected response.", { details });
  }
}
