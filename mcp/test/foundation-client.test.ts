import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient, type ApiClientOptions, type FetchLike } from "../src/api/client";
import type { TripdremoConfig } from "../src/config";
import { TripdremoError } from "../src/errors";

const config: TripdremoConfig = {
  apiBaseUrl: "https://example.test/api/v1",
  siteUrl: "https://example.test",
  locale: "en",
  configDir: "/tmp/tripdremo-foundation-test",
  timeoutMs: 100,
  submitTimeoutMs: 500,
  logLevel: "silent",
};
const secretToken = ["cli", "super", "secret", "abcd"].join("_");

function response(status: number, body: unknown = {}, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function client(fetch: FetchLike, extra: Partial<ApiClientOptions> = {}): ApiClient {
  return new ApiClient({ config, fetch, sleep: async () => {}, random: () => 0, tokenProvider: () => secretToken, ...extra });
}

test("foundation client sends user agent and injected token through one fetch wrapper", async () => {
  let observed: RequestInit | undefined;
  const result = await client(async (_url, init) => {
    observed = init;
    return response(200, { ok: true });
  }).request<{ ok: boolean }>("get", "/health/");
  const headers = new Headers(observed?.headers);
  assert.deepEqual(result, { ok: true });
  assert.equal(headers.get("User-Agent"), "tripdremo-mcp/0.2.1 (+https://tripdremo.com)");
  assert.equal(headers.get("Authorization"), `Bearer ${secretToken}`);
});

test("foundation client can make a fully anonymous public request", async () => {
  let observed: RequestInit | undefined;
  const publicConfig = { ...config, apiBaseUrl: "http://localhost:8000/api/v1", devUser: "cli-smoke" };
  const result = await client(async (_url, init) => {
    observed = init;
    return response(200, { ok: true });
  }, { config: publicConfig }).requestAnonymous<{ ok: boolean }>("get", "/share/public/");
  const headers = new Headers(observed?.headers);
  assert.deepEqual(result, { ok: true });
  assert.equal(headers.has("Authorization"), false);
  assert.equal(headers.has("X-Travel-User"), false);
  assert.equal(headers.get("User-Agent"), "tripdremo-mcp/0.2.1 (+https://tripdremo.com)");
});

test("foundation client confines an explicit tombstone token to its one request", async () => {
  let observed: RequestInit | undefined;
  const tombstoneToken = ["cli", "pending", "revoke", "last"].join("_");
  const publicConfig = { ...config, apiBaseUrl: "http://localhost:8000/api/v1", devUser: "cli-smoke" };
  await client(async (_url, init) => {
    observed = init;
    return response(200, { ok: true });
  }, { config: publicConfig }).requestWithToken("post", "/cli/auth/revoke/", {}, tombstoneToken);
  const headers = new Headers(observed?.headers);
  assert.equal(headers.get("Authorization"), `Bearer ${tombstoneToken}`);
  assert.equal(headers.has("X-Travel-User"), false);
});

test("foundation client never exceeds three attempts and retries only retryable failures", async () => {
  let calls = 0;
  const failures = client(async () => {
    calls += 1;
    return response(500, { detail: "unavailable" });
  });
  await assert.rejects(() => failures.request("get", "/trips/"), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "backend_unreachable");
    return true;
  });
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(() => client(async () => {
    calls += 1;
    return response(400, { prompt: ["required"] });
  }).request("post", "/trips/generate/", {}), (error: unknown) => error instanceof TripdremoError && error.code === "invalid_request");
  assert.equal(calls, 1);
});

test("foundation client honors Retry-After and maps final 429", async () => {
  const delays: number[] = [];
  let calls = 0;
  const api = new ApiClient({
    config: { ...config, timeoutMs: 5_000 },
    fetch: async () => {
      calls += 1;
      return response(429, { detail: "slow down" }, { "Retry-After": "2" });
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    random: () => 0,
    tokenProvider: () => undefined,
  });
  await assert.rejects(() => api.request("get", "/trips/"), (error: unknown) => error instanceof TripdremoError && error.code === "rate_limited");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 2000]);
});

test("foundation client refuses an excessive Retry-After without sleeping or retrying early", async () => {
  const delays: number[] = [];
  let calls = 0;
  const api = new ApiClient({
    config,
    fetch: async () => {
      calls += 1;
      return response(429, { detail: "slow down" }, { "Retry-After": "3600" });
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    tokenProvider: () => undefined,
  });
  await assert.rejects(() => api.request("get", "/trips/"), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "rate_limited");
    assert.equal(error.details.retry_after, "3600");
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("foundation client maps auth, quota, plan context, and generation 502 by code", async () => {
  const cases = [
    [401, "/trips/", "not_authenticated"],
    [403, "/trips/generate/", "quota_exceeded"],
    [404, "/share/missing/", "plan_not_found"],
  ] as const;
  for (const [status, path, code] of cases) {
    await assert.rejects(() => client(async () => response(status, { detail: "x" })).request("get", path), (error: unknown) => {
      assert.ok(error instanceof TripdremoError);
      assert.equal(error.code, code);
      assert.equal(error.details.path, path);
      return true;
    });
  }
  await assert.rejects(() => client(async () => response(502, {
    detail: "provider failed",
    headers: { Authorization: `Bearer ${secretToken}` },
  })).request("post", "/trips/generate/", {}), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "generation_failed");
    assert.equal(error.details.reason, "provider failed");
    assert.equal(JSON.stringify(error.toJson()).includes("super_secret"), false);
    return true;
  });
});

test("foundation client maps disabled backend AI without retrying", async () => {
  let calls = 0;
  await assert.rejects(() => client(async () => {
    calls += 1;
    return response(503, { code: "backend_ai_disabled", detail: "Cloud generation is off." });
  }).request("post", "/trips/agent-generate/", {}), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "backend_ai_disabled");
    assert.equal(error.retryable, false);
    assert.match(error.message, /author the plan locally/i);
    assert.equal(error.details.code, "backend_ai_disabled");
    return true;
  });
  assert.equal(calls, 1);
});

test("foundation client maps only the typed generation-in-progress conflict", async () => {
  await assert.rejects(() => client(async () => response(409, {
    code: "generation_in_progress",
    detail: "Existing reservation is still active.",
  })).request("post", "/trips/generate/", {}), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "invalid_request");
    assert.equal(error.retryable, true);
    assert.equal(error.message, "A Tripdremo generation is already in progress for this account.");
    assert.equal(error.details.code, "generation_in_progress");
    assert.equal(error.details.detail, "Existing reservation is still active.");
    return true;
  });

  await assert.rejects(() => client(async () => response(409, {
    code: "some_other_conflict",
    detail: "Unknown conflict.",
  })).request("post", "/trips/generate/", {}), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "internal");
    return true;
  });
});

test("foundation client maps only the identity-changed 409 to a retryable request error", async () => {
  let calls = 0;
  await assert.rejects(() => client(async () => {
    calls += 1;
    return response(409, { code: "identity_changed", detail: "Retry the request." });
  }).request("post", "/trips/generate/", {}), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "invalid_request");
    assert.equal(error.retryable, true);
    assert.equal(error.details.code, "identity_changed");
    assert.equal("incident_id" in error.details, false);
    return true;
  });
  assert.equal(calls, 1);

  await assert.rejects(() => client(async () => response(409, {
    code: "some_other_conflict",
  })).request("post", "/trips/generate/", {}), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "internal");
    return true;
  });
});

test("foundation client does not retry ambiguous network failures", async () => {
  let calls = 0;
  await assert.rejects(() => client(async () => {
    calls += 1;
    throw new TypeError(`network down with ${secretToken}`);
  }).request("get", "/health/"), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "backend_unreachable");
    assert.equal(JSON.stringify(error.toJson()).includes("super_secret"), false);
    return true;
  });
  assert.equal(calls, 1);
});

test("foundation client aborts a timed-out attempt without duplicating the request", async () => {
  let calls = 0;
  const timeoutConfig = { ...config, timeoutMs: 5 };
  const api = new ApiClient({
    config: timeoutConfig,
    fetch: async (_url, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    },
    sleep: async () => {},
    random: () => 0,
    tokenProvider: () => undefined,
  });
  await assert.rejects(() => api.request("get", "/slow/"), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "backend_unreachable");
    assert.equal(error.details.reason, "timeout");
    return true;
  });
  assert.equal(calls, 1);
});

test("foundation client gives synchronous plan submission its dedicated timeout", async () => {
  const submissionConfig = { ...config, timeoutMs: 5, submitTimeoutMs: 100 };
  const api = new ApiClient({
    config: submissionConfig,
    fetch: async (_url, init) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(response(422, {
        status: "needs_revision",
        schema_version: "trip-plan.v3",
        issues: [{ path: "$.trip", code: "required", message: "Trip is required" }],
        plan: {},
      })), 20);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
    sleep: async () => {},
    random: () => 0,
    tokenProvider: () => secretToken,
  });
  const result = await api.requestPlanSubmission({ schema_version: "trip-plan.v3", request: {}, plan: {} });
  assert.equal(result.status, 422);
});

test("foundation client never retries plan-submission 5xx and preserves safe infrastructure details", async () => {
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    return response(503, { code: "enrichment_unavailable", detail: "Image enrichment is unavailable." });
  });
  await assert.rejects(() => api.requestPlanSubmission({ submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8" }), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "backend_unreachable");
    assert.equal(error.retryable, true);
    assert.equal(error.details.code, "enrichment_unavailable");
    assert.equal(error.details.detail, "Image enrichment is unavailable.");
    assert.equal(error.details.path, "/trips/agent-submit/");
    return true;
  });
  assert.equal(calls, 1);
});

test("foundation client maps narrow plan-submission idempotency conflicts without retrying", async () => {
  for (const [backendCode, retryable] of [
    ["submission_in_progress", true],
    ["idempotency_conflict", false],
  ] as const) {
    let calls = 0;
    await assert.rejects(() => client(async () => {
      calls += 1;
      return response(409, { code: backendCode, detail: "Safe conflict detail." });
    }).requestPlanSubmission({ submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8" }), (error: unknown) => {
      assert.ok(error instanceof TripdremoError);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.retryable, retryable);
      assert.equal(error.details.code, backendCode);
      assert.equal(error.details.detail, "Safe conflict detail.");
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("foundation client never retries a network-ambiguous plan submission", async () => {
  let calls = 0;
  await assert.rejects(() => client(async () => {
    calls += 1;
    throw new TypeError("connection closed after write");
  }).requestPlanSubmission({ submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8" }), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "backend_unreachable");
    assert.equal(error.retryable, true);
    assert.equal(error.details.reason, "network_error");
    return true;
  });
  assert.equal(calls, 1);
});
