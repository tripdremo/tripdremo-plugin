import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import type { ApiClient } from "../src/api/client";
import { deleteCredential, readCredential, writeCredential } from "../src/auth/store";
import { TripdremoError } from "../src/errors";
import { createPlan } from "../src/tools/create_plan";
import { getPlan } from "../src/tools/get_plan";
import { getPlanSchema } from "../src/tools/get_plan_schema";
import { listPlans } from "../src/tools/list_plans";
import { savePlanToAccount } from "../src/tools/save_plan";
import { submitPlan } from "../src/tools/submit_plan";
import { planStatus } from "../src/tools/plan_status";
import { writePlans } from "../src/auth/store";
import { resolveShareUrl } from "../src/tools/helpers";

let configDir = "";

beforeEach(() => {
  configDir = mkdtempSync(path.join(os.tmpdir(), "tripdremo-planning-"));
  process.env.TRIPDREMO_CONFIG_DIR = configDir;
  process.env.TRIPDREMO_SITE_URL = "https://tripdremo.com";
  process.env.TRIPDREMO_LOCALE = "lt";
  delete process.env.TRIPDREMO_DEV_USER;
  delete process.env.TRIPDREMO_API_BASE_URL;
  writeCredential({ token: ["cli", "guest", "test"].join("_"), planType: "guest" });
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  delete process.env.TRIPDREMO_CONFIG_DIR;
  delete process.env.TRIPDREMO_SITE_URL;
  delete process.env.TRIPDREMO_LOCALE;
  delete process.env.TRIPDREMO_DEV_USER;
  delete process.env.TRIPDREMO_API_BASE_URL;
});

function stubClient(handler: (method: string, route: string, body?: unknown) => unknown): ApiClient {
  return {
    request: async (method: string, route: string, body?: unknown) => handler(method, route, body),
    requestAnonymous: async (method: string, route: string, body?: unknown) => handler(method, route, body),
  } as unknown as ApiClient;
}

function tripDetail() {
  return {
    id: 42,
    share_hash: "ab12cd34",
    share_url: "/plans/ab12cd34",
    title: "Dolomites",
    subtitle: "Slow mornings",
    destination: "Dolomites",
    dates: { start: "2026-07-04", end: "2026-07-05" },
    status: "ready",
    trip_payload: {
      data: {
        days: [{ day: 1, title: "Bolzano to Ortisei", places: [{}, {}], drive: { estimate: "48 min" } }],
      },
    },
  };
}

const generateArgs = {
  prompt: "Plan the Dolomites",
  start_date: "2026-07-04",
  end_date: "2026-07-05",
};

test("create_plan handles a synchronous TripDetail and derives dev auth as user", async () => {
  process.env.TRIPDREMO_API_BASE_URL = "http://localhost:8000/api/v1";
  process.env.TRIPDREMO_DEV_USER = "cli-smoke";
  let requestBody: unknown;
  const result = await createPlan(generateArgs, stubClient((_method, route, body) => {
    assert.equal(route, "/trips/agent-generate/");
    requestBody = body;
    return tripDetail();
  }));
  assert.equal(result.status, "ready");
  assert.equal(result.plan.owner_kind, "user");
  assert.equal(result.plan.share_url, "https://tripdremo.com/lt/plans/ab12cd34");
  assert.deepEqual(requestBody, {
    prompt: "Plan the Dolomites",
    origin: "",
    destination: "",
    start_date: "2026-07-04",
    end_date: "2026-07-05",
    adults: 2,
    children: [],
    style: "balanced",
    budget: "comfortable",
    constraints: {},
  });
});

test("a token alone is not guessed to be a user identity", async () => {
  writeCredential({ token: ["cli", "test", "token"].join("_") });
  const result = await createPlan(generateArgs, stubClient(() => tripDetail()));
  assert.equal(result.status, "ready");
  assert.equal(result.plan.owner_kind, "guest");
});

test("create_plan leaves guest quota enforcement to the authoritative backend", async () => {
  writePlans([{ share_hash: "abc123", title: "Guest Draft", created_at: new Date().toISOString() }]);
  const result = await createPlan(generateArgs, stubClient(() => tripDetail()));
  assert.equal(result.status, "ready");
});

test("first create auto-provisions a guest identity without exposing its token", async () => {
  deleteCredential();
  const issuedToken = ["cli", "auto", "provisioned", "last"].join("_");
  const routes: string[] = [];
  const client = {
    requestAnonymous: async (_method: string, route: string) => {
      routes.push(route);
      return {
        cli_token: issuedToken,
        device_code: "device-auto",
        user_code: "AUTO-12",
        verification_uri: "https://tripdremo.com/lt/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=AUTO-12",
        expires_in: 300,
        interval: 5,
      };
    },
    request: async (_method: string, route: string) => {
      routes.push(route);
      assert.equal(readCredential().token, issuedToken);
      return tripDetail();
    },
  } as unknown as ApiClient;
  const result = await createPlan(generateArgs, client);
  assert.deepEqual(routes, ["/cli/auth/device/", "/trips/agent-generate/"]);
  assert.equal(JSON.stringify(result).includes(issuedToken), false);
  assert.equal(readCredential().planType, "guest");
});

test("create_plan rejects a draft response because its public plan is unavailable", async () => {
  await assert.rejects(() => createPlan(generateArgs, stubClient(() => ({ ...tripDetail(), status: "draft" }))), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal(error.code, "generation_failed");
    assert.equal(error.details.status, "draft");
    assert.equal(JSON.stringify(error.toJson()).includes("trip_payload"), false);
    return true;
  });
});

test("create_plan returns the async handle immediately when the wait budget is zero", async () => {
  const result = await createPlan({ ...generateArgs, wait_seconds: 0 }, stubClient(() => ({
    status: "generating",
    generation_job: { id: 12, status: "running", progress_status: "queued" },
    progress_url: "/api/v1/generation-jobs/12/progress/",
  })));
  assert.deepEqual(result, {
    status: "generating",
    job_id: 12,
    progress_url: "/api/v1/generation-jobs/12/progress/",
    poll_after_seconds: 2,
  });
});

test("create_plan uses its bounded wait budget to return a completed plan", async () => {
  let calls = 0;
  const result = await createPlan({ ...generateArgs, wait_seconds: 1 }, stubClient((_method, route) => {
    calls += 1;
    if (route === "/trips/agent-generate/") return { status: "generating", generation_job: { id: 12 } };
    return { generation_job: { id: 12, status: "completed", progress_status: "ready" }, trip: tripDetail() };
  }));
  assert.equal(result.status, "ready");
  assert.equal(calls, 2);
});

test("get_plan_schema fetches and validates the live schema anonymously", async () => {
  let method = "";
  let route = "";
  const result = await getPlanSchema(stubClient((requestedMethod, requestedRoute) => {
    method = requestedMethod;
    route = requestedRoute;
    return {
      name: "Trip Plan v3",
      version: "trip-plan.v3",
      sha256: "b".repeat(64),
      schema: { type: "object", additionalProperties: false },
    };
  }));
  assert.equal(method, "get");
  assert.equal(route, "/agent/schemas/trip-plan/v3/");
  assert.equal(result.version, "trip-plan.v3");
  assert.equal(result.schema.type, "object");
});

test("submit_plan returns structured 422 revision feedback without calling generation", async () => {
  const routes: string[] = [];
  const client = {
    requestPlanSubmission: async (body: unknown) => {
      routes.push("/trips/agent-submit/");
      assert.equal(typeof body, "object");
      const envelope = body as Record<string, unknown>;
      assert.match(String(envelope.submission_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.deepEqual({ ...envelope, submission_id: "stable-id" }, {
        submission_id: "stable-id",
        schema_version: "trip-plan.v3",
        request: generateArgs,
        plan: { trip: { title: "Dolomites" }, days: [{}] },
      });
      return {
        status: 422,
        headers: new Headers(),
        body: {
          status: "needs_revision",
          schema_version: "trip-plan.v3",
          issues: [{
            path: "$.days[0].title",
            code: "required",
            message: "Title is required",
            suggestion: "Add a descriptive title.",
            provenance: "schema",
          }],
          plan: { trip: { title: "Dolomites" }, days: [{}], access_token: ["must", "not", "leak"].join("_") },
          diagnostics: { internal: true },
        },
      };
    },
  } as unknown as ApiClient;
  const result = await submitPlan({
    schema_version: "trip-plan.v3",
    request: generateArgs,
    plan: { trip: { title: "Dolomites" }, days: [{}] },
  }, client);
  assert.deepEqual(routes, ["/trips/agent-submit/"]);
  assert.deepEqual(result, {
    status: "needs_revision",
    schema_version: "trip-plan.v3",
    issues: [{ path: "$.days[0].title", code: "required", message: "Title is required", suggestion: "Add a descriptive title." }],
    plan: { trip: { title: "Dolomites" }, days: [{}], access_token: "[REDACTED]" },
  });
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), false);
});

test("submit_plan persists a redacted hardened pending write and reuses its UUID after a lost response", async () => {
  const submissionIds: string[] = [];
  let calls = 0;
  const client = {
    requestPlanSubmission: async (body: unknown) => {
      calls += 1;
      const envelope = body as { submission_id: string };
      submissionIds.push(envelope.submission_id);
      if (calls === 1) throw new TripdremoError("backend_unreachable", "lost response", { retryable: true });
      return { status: 201, headers: new Headers(), body: tripDetail() };
    },
  } as unknown as ApiClient;
  const args = {
    schema_version: "trip-plan.v3" as const,
    request: generateArgs,
    plan: { trip: { title: "Sensitive itinerary title" }, days: [{}] },
  };
  await assert.rejects(() => submitPlan(args, client), (error: unknown) => error instanceof TripdremoError && error.code === "backend_unreachable");

  const pendingPath = path.join(configDir, "pending-submission.json");
  assert.equal(statSync(pendingPath).mode & 0o777, 0o600);
  const pendingText = readFileSync(pendingPath, "utf8");
  const pending = JSON.parse(pendingText) as Record<string, unknown>;
  assert.deepEqual(Object.keys(pending).sort(), ["created_at", "identity_hash", "payload_hash", "submission_id"]);
  assert.equal(String(pending.payload_hash).length, 64);
  assert.equal(pendingText.includes("Sensitive itinerary title"), false);
  assert.equal(pendingText.includes("Plan the Dolomites"), false);
  assert.equal(pendingText.includes(String(readCredential().token)), false);

  const result = await submitPlan(args, client);
  assert.equal(result.status, "ready");
  assert.equal(calls, 2);
  assert.equal(submissionIds[0], submissionIds[1]);
  assert.equal(existsSync(pendingPath), false);
});

test("submit_plan blocks different content while an ambiguous submission is live", async () => {
  let calls = 0;
  const client = {
    requestPlanSubmission: async () => {
      calls += 1;
      throw new TripdremoError("backend_unreachable", "lost response", { retryable: true });
    },
  } as unknown as ApiClient;
  const first = { schema_version: "trip-plan.v3" as const, request: generateArgs, plan: { trip: { title: "First" } } };
  await assert.rejects(() => submitPlan(first, client), TripdremoError);
  await assert.rejects(
    () => submitPlan({ ...first, plan: { trip: { title: "Different" } } }, client),
    (error: unknown) => {
      assert.ok(error instanceof TripdremoError);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.retryable, true);
      assert.equal(error.details.reason, "ambiguous_submission_pending");
      assert.equal("submission_id" in error.details, false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("submit_plan reuses pending UUID after submission_in_progress", async () => {
  const ids: string[] = [];
  let calls = 0;
  const client = {
    requestPlanSubmission: async (body: unknown) => {
      calls += 1;
      ids.push(String((body as { submission_id: unknown }).submission_id));
      if (calls === 1) {
        throw new TripdremoError("invalid_request", "still processing", {
          retryable: true,
          details: { status: 409, code: "submission_in_progress" },
        });
      }
      return { status: 201, headers: new Headers(), body: tripDetail() };
    },
  } as unknown as ApiClient;
  const args = { schema_version: "trip-plan.v3" as const, request: generateArgs, plan: { trip: {} } };
  await assert.rejects(() => submitPlan(args, client), TripdremoError);
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), true);
  assert.equal((await submitPlan(args, client)).status, "ready");
  assert.deepEqual(ids, [ids[0], ids[0]]);
});

test("submit_plan clears pending state on definitive idempotency conflict", async () => {
  const client = {
    requestPlanSubmission: async () => {
      throw new TripdremoError("invalid_request", "conflict", { details: { code: "idempotency_conflict" } });
    },
  } as unknown as ApiClient;
  await assert.rejects(
    () => submitPlan({ schema_version: "trip-plan.v3", request: generateArgs, plan: { trip: {} } }, client),
    TripdremoError,
  );
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), false);
});

test("submit_plan clears pending state on definitive quota rejection", async () => {
  const client = {
    requestPlanSubmission: async () => {
      throw new TripdremoError("quota_exceeded", "quota reached", { details: { status: 403, code: "quota_exceeded" } });
    },
  } as unknown as ApiClient;
  await assert.rejects(
    () => submitPlan({ schema_version: "trip-plan.v3", request: generateArgs, plan: { trip: {} } }, client),
    (error: unknown) => error instanceof TripdremoError && error.code === "quota_exceeded",
  );
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), false);
});

test("submit_plan retains pending state when a terminal status has a malformed body", async () => {
  const client = {
    requestPlanSubmission: async () => ({ status: 201, headers: new Headers(), body: { status: "ready" } }),
  } as unknown as ApiClient;
  await assert.rejects(
    () => submitPlan({ schema_version: "trip-plan.v3", request: generateArgs, plan: { trip: {} } }, client),
    (error: unknown) => error instanceof TripdremoError && error.code === "internal",
  );
  assert.equal(existsSync(path.join(configDir, "pending-submission.json")), true);
});

test("submit_plan projects a ready direct TripDetail and remembers a guest plan", async () => {
  const client = {
    requestPlanSubmission: async () => {
      return { status: 201, headers: new Headers(), body: tripDetail() };
    },
  } as unknown as ApiClient;
  const result = await submitPlan({ schema_version: "trip-plan.v3", request: generateArgs, plan: { trip: {} } }, client);
  assert.equal(result.status, "ready");
  assert.equal(result.plan.share_url, "https://tripdremo.com/lt/plans/ab12cd34");
  assert.equal(result.plan.owner_kind, "guest");
});

test("first submit auto-provisions the same secure guest identity without generation fallback", async () => {
  deleteCredential();
  const issuedToken = ["cli", "submit", "guest", "last"].join("_");
  const routes: string[] = [];
  const client = {
    requestAnonymous: async (_method: string, route: string) => {
      routes.push(route);
      return {
        cli_token: issuedToken,
        device_code: "device-submit",
        user_code: "SUBMIT-1",
        verification_uri: "https://tripdremo.com/lt/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/lt/cli/authorize?code=SUBMIT-1",
        expires_in: 300,
        interval: 5,
      };
    },
    requestPlanSubmission: async () => {
      routes.push("/trips/agent-submit/");
      assert.equal(readCredential().token, issuedToken);
      return { status: 201, headers: new Headers(), body: tripDetail() };
    },
  } as unknown as ApiClient;
  const result = await submitPlan({ schema_version: "trip-plan.v3", request: generateArgs, plan: { trip: {} } }, client);
  assert.deepEqual(routes, ["/cli/auth/device/", "/trips/agent-submit/"]);
  assert.equal(routes.includes("/trips/agent-generate/"), false);
  assert.equal(routes.includes("/trips/generate/"), false);
  assert.equal(JSON.stringify(result).includes(issuedToken), false);
});

test("plan_status reads nested generation job state and maps failure reason", async () => {
  const failed = await planStatus({ job_id: 12 }, stubClient(() => ({
    generation_job: { id: 12, status: "failed", progress_status: "failed", error: "Provider refused output" },
  })));
  assert.deepEqual(failed, {
    status: "failed",
    error: {
      code: "generation_failed",
      message: "Provider refused output",
      retryable: false,
      details: { reason: "Provider refused output" },
    },
  });
});

test("plan_status does not expose a completed draft as ready", async () => {
  const draft = await planStatus({ job_id: 12 }, stubClient(() => ({
    generation_job: { id: 12, status: "completed" },
    trip: { ...tripDetail(), status: "draft" },
  })));
  assert.equal(draft.status, "failed");
  assert.equal(draft.error.code, "generation_failed");
  assert.equal(draft.error.details.status, "draft");

  const missing = await planStatus({ job_id: 13 }, stubClient(() => ({
    generation_job: { id: 13, status: "completed" },
  })));
  assert.equal(missing.status, "failed");
  assert.equal(missing.error.code, "generation_failed");
});

test("get_plan uses the public share endpoint and includes payload only on true", async () => {
  let requested = "";
  const client = stubClient((_method, route) => {
    requested = route;
    return tripDetail();
  });
  const compact = await getPlan({ share_hash: "ab12cd34" }, client);
  const complete = await getPlan({ share_hash: "ab12cd34", include_payload: true }, client);
  assert.equal(requested, "/share/ab12cd34/");
  assert.equal("trip_payload" in compact.plan, false);
  assert.equal("trip_payload" in complete.plan, true);
  assert.equal(complete.plan.share_url, "https://tripdremo.com/lt/plans/ab12cd34");
});

test("get_plan encodes the share hash in both the endpoint and public URL", async () => {
  let requested = "";
  const result = await getPlan({ share_hash: "ab/c d" }, stubClient((_method, route) => {
    requested = route;
    return { ...tripDetail(), share_hash: "ab/c d" };
  }));
  assert.equal(requested, "/share/ab%2Fc%20d/");
  assert.equal(result.plan.share_url, "https://tripdremo.com/lt/plans/ab%2Fc%20d");
});

test("list_plans skips the account request only while unauthenticated", async () => {
  let calls = 0;
  const result = await listPlans({}, stubClient(() => {
    calls += 1;
    throw new Error("must not be called");
  }));
  assert.equal(calls, 0);
  assert.deepEqual(result.account, []);
});

test("list_plans preserves meaningful account errors", async () => {
  process.env.TRIPDREMO_API_BASE_URL = "http://localhost:8000/api/v1";
  process.env.TRIPDREMO_DEV_USER = "cli-smoke";
  const error = new TripdremoError("backend_unreachable", "backend down");
  await assert.rejects(() => listPlans({}, stubClient(() => { throw error; })), error);
});

test("save_plan_to_account requires an authenticated user", async () => {
  await assert.rejects(() => savePlanToAccount({ share_hash: "ab12cd34" }, stubClient(() => ({
    share_hash: "ab12cd34",
    share_url: "/plans/ab12cd34",
    title: "Draft",
    subtitle: "",
    destination: "",
    dates: { start: "2026-07-01", end: "2026-07-02" },
    status: "ready",
    trip_payload: {},
  }))), (error: unknown) => {
    assert.ok(error instanceof TripdremoError);
    assert.equal((error as TripdremoError).code, "not_authenticated");
    return true;
  });
});

test("save_plan_to_account URL-encodes the hash and returns account ownership", async () => {
  writeCredential({ token: ["cli", "user", "test"].join("_"), planType: "user" });
  let route = "";
  const result = await savePlanToAccount({ share_hash: "ab/c d" }, stubClient((_method, requestedRoute) => {
    route = requestedRoute;
    return { ...tripDetail(), share_hash: "ab/c d" };
  }));
  assert.equal(route, "/share/ab%2Fc%20d/save/");
  assert.equal(result.plan.share_url, "https://tripdremo.com/lt/plans/ab%2Fc%20d");
  assert.equal(result.plan.owner_kind, "user");
});

test("list_plans follows fixed-size DRF pages and truncates at the requested limit", async () => {
  process.env.TRIPDREMO_API_BASE_URL = "http://localhost:8000/api/v1";
  process.env.TRIPDREMO_DEV_USER = "cli-smoke";
  const routes: string[] = [];
  const result = await listPlans({ limit: 45 }, stubClient((_method, route) => {
    routes.push(route);
    const page = Number(new URL(route, "https://example.test").searchParams.get("page"));
    const count = page < 3 ? 20 : 20;
    return {
      next: page < 3 ? `https://example.test/api/v1/trips/?page=${page + 1}` : null,
      results: Array.from({ length: count }, (_, index) => ({
        ...tripDetail(),
        trip_payload: undefined,
        share_hash: `hash/${page}-${index}`,
      })),
    };
  }));
  assert.deepEqual(routes, ["/trips/?page=1", "/trips/?page=2", "/trips/?page=3"]);
  assert.equal(result.account.length, 45);
  assert.equal(result.account[0]?.share_url, "https://tripdremo.com/lt/plans/hash%2F1-0");
  assert.equal(routes.some((route) => route.includes("page_size")), false);
});

test("share URLs cover every supported locale", () => {
  for (const locale of ["en", "lt", "de", "pl"]) {
    process.env.TRIPDREMO_LOCALE = locale;
    assert.equal(resolveShareUrl("/plans/hash"), `https://tripdremo.com/${locale}/plans/hash`);
  }
});
