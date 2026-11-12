import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function compileContract(name: string): Promise<ValidateFunction> {
  const source = await readFile(path.join(repositoryRoot, "contracts", name), "utf8");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  if (name === "tripdremo-plan-submission.v1.schema.json") {
    const planResult = await readFile(path.join(repositoryRoot, "contracts", "tripdremo-plan-result.v1.schema.json"), "utf8");
    ajv.addSchema(JSON.parse(planResult));
  }
  return ajv.compile(JSON.parse(source));
}

const compactPlan = {
  share_hash: "ab12cd34",
  share_url: "https://tripdremo.com/en/plans/ab12cd34",
  title: "Five days in the Dolomites",
  subtitle: "A balanced family road trip",
  destination: "Dolomites",
  dates: { start: "2026-07-04", end: "2026-07-08" },
  day_count: 1,
  status: "ready",
  owner_kind: "guest",
  days: [
    { index: 1, title: "Bolzano to Ortisei", stop_count: 2, drive_summary: "48 min drive" },
  ],
};

test("plan request contract accepts a representative generation request", async () => {
  const validate = await compileContract("tripdremo-plan-request.v1.schema.json");
  assert.equal(validate({
    prompt: "Plan a balanced family road trip",
    origin: "Vilnius",
    destination: "Dolomites",
    start_date: "2026-07-04",
    end_date: "2026-07-08",
    adults: 2,
    children: [{ age: 0 }, { age: 17 }],
    style: "balanced",
    budget: "comfortable",
    constraints: { avoid_tolls: true },
    wait_seconds: 30,
  }), true, JSON.stringify(validate.errors));
});

test("plan request contract rejects unknown fields", async () => {
  const validate = await compileContract("tripdremo-plan-request.v1.schema.json");
  assert.equal(validate({
    prompt: "Plan a trip",
    start_date: "2026-07-04",
    end_date: "2026-07-08",
    password: "must-not-be-accepted",
  }), false);
});

test("all plan request contracts cap children at 12", async () => {
  const children = Array.from({ length: 13 }, () => ({ age: 8 }));
  const request = { prompt: "Plan a trip", start_date: "2026-07-04", end_date: "2026-07-08", children };
  const planRequest = await compileContract("tripdremo-plan-request.v1.schema.json");
  const submissionRequest = await compileContract("tripdremo-plan-submission-request.v1.schema.json");
  const envelope = await compileContract("tripdremo-agent-submit-envelope.v1.schema.json");
  assert.equal(planRequest(request), false);
  assert.equal(submissionRequest({ schema_version: "trip-plan.v3", request, plan: {} }), false);
  assert.equal(envelope({
    submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    schema_version: "trip-plan.v3",
    request,
    plan: {},
  }), false);
});

test("plan result contract accepts the canonical compact plan", async () => {
  const validate = await compileContract("tripdremo-plan-result.v1.schema.json");
  assert.equal(validate(compactPlan), true, JSON.stringify(validate.errors));
});

test("plan result contract accepts an explicitly requested source payload", async () => {
  const validate = await compileContract("tripdremo-plan-result.v1.schema.json");
  assert.equal(validate({ ...compactPlan, trip_payload: { data: { days: [] } } }), true, JSON.stringify(validate.errors));
});

test("plan result contract rejects legacy plan_id", async () => {
  const validate = await compileContract("tripdremo-plan-result.v1.schema.json");
  assert.equal(validate({ ...compactPlan, plan_id: 42 }), false);
});

test("plan result contract rejects legacy status_detail", async () => {
  const validate = await compileContract("tripdremo-plan-result.v1.schema.json");
  assert.equal(validate({ ...compactPlan, status_detail: "complete" }), false);
});

test("plan result contract rejects a path-only share URL", async () => {
  const validate = await compileContract("tripdremo-plan-result.v1.schema.json");
  assert.equal(validate({ ...compactPlan, share_url: "/plans/ab12cd34" }), false);
});

test("live plan schema result contract accepts a representative response", async () => {
  const validate = await compileContract("tripdremo-plan-schema-result.v1.schema.json");
  assert.equal(validate({
    name: "Trip Plan v3",
    version: "trip-plan.v3",
    sha256: "a".repeat(64),
    schema: { type: "object", required: ["trip", "days"] },
  }), true, JSON.stringify(validate.errors));
});

test("plan submission contract accepts ready and needs-revision results", async () => {
  const validate = await compileContract("tripdremo-plan-submission.v1.schema.json");
  assert.equal(validate({ status: "ready", plan: compactPlan }), true, JSON.stringify(validate.errors));
  assert.equal(validate({
    status: "needs_revision",
    schema_version: "trip-plan.v3",
    issues: [{ path: "$.days[0].title", code: "required", message: "Title is required", suggestion: "Add a useful title." }],
    plan: { trip: {}, days: [{}] },
  }), true, JSON.stringify(validate.errors));
});

test("plan submission request contract accepts a local plan and forbids wait_seconds", async () => {
  const validate = await compileContract("tripdremo-plan-submission-request.v1.schema.json");
  const request = {
    schema_version: "trip-plan.v3",
    request: {
      prompt: "Plan a balanced family road trip",
      start_date: "2026-07-04",
      end_date: "2026-07-08",
      constraints: { avoid_tolls: true },
    },
    plan: { trip: { title: "Dolomites" }, days: [] },
  };
  assert.equal(validate(request), true, JSON.stringify(validate.errors));
  assert.equal(validate({
    ...request,
    request: { ...request.request, wait_seconds: 30 },
  }), false);
});

test("internal agent-submit envelope requires a UUID submission_id", async () => {
  const validate = await compileContract("tripdremo-agent-submit-envelope.v1.schema.json");
  const envelope = {
    submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    schema_version: "trip-plan.v3",
    request: { prompt: "Plan locally", start_date: "2026-07-04", end_date: "2026-07-05" },
    plan: { trip: {}, days: [] },
  };
  assert.equal(validate(envelope), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...envelope, submission_id: "not-a-uuid" }), false);
  assert.equal(validate({ ...envelope, retry_count: 1 }), false);
});

test("pending submission contract contains only hardened replay metadata", async () => {
  const validate = await compileContract("tripdremo-pending-submission.v1.schema.json");
  const pending = {
    submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    payload_hash: "a".repeat(64),
    identity_hash: "b".repeat(64),
    created_at: "2026-08-17T12:00:00.000Z",
  };
  assert.equal(validate(pending), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...pending, plan: { trip: {} } }), false);
  assert.equal(validate({ ...pending, token: "forbidden" }), false);
});

test("plan submission contract rejects incomplete revision issues", async () => {
  const validate = await compileContract("tripdremo-plan-submission.v1.schema.json");
  assert.equal(validate({
    status: "needs_revision",
    schema_version: "trip-plan.v3",
    issues: [{ path: "$.days[0]", message: "Invalid day" }],
    plan: {},
  }), false);
});

test("auth state contract accepts a matching unauthenticated state", async () => {
  const validate = await compileContract("tripdremo-auth-state.v1.schema.json");
  assert.equal(validate({
    authenticated: false,
    kind: "none",
    device_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    api_base_url: "https://tripdremo.com/api/v1",
  }), true, JSON.stringify(validate.errors));
});

test("auth state contract accepts a matching authenticated state", async () => {
  const validate = await compileContract("tripdremo-auth-state.v1.schema.json");
  assert.equal(validate({
    authenticated: true,
    kind: "user",
    email: "traveller@example.com",
    device_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    plans_used: 1,
    plans_limit: 3,
    api_base_url: "https://tripdremo.com/api/v1",
  }), true, JSON.stringify(validate.errors));
});

test("auth state contract rejects an authentication-kind mismatch", async () => {
  const validate = await compileContract("tripdremo-auth-state.v1.schema.json");
  assert.equal(validate({
    authenticated: false,
    kind: "guest",
    device_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    api_base_url: "https://tripdremo.com/api/v1",
  }), false);
});

test("auth state contract rejects extra fields", async () => {
  const validate = await compileContract("tripdremo-auth-state.v1.schema.json");
  assert.equal(validate({
    authenticated: false,
    kind: "none",
    device_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
    api_base_url: "https://tripdremo.com/api/v1",
    token: "must-not-be-exposed",
  }), false);
});

test("auth state contract rejects a non-UUID device ID", async () => {
  const validate = await compileContract("tripdremo-auth-state.v1.schema.json");
  assert.equal(validate({
    authenticated: false,
    kind: "none",
    device_id: "device-1",
    api_base_url: "https://tripdremo.com/api/v1",
  }), false);
});

test("error contract accepts every closed v1 error code", async () => {
  const validate = await compileContract("tripdremo-error.v1.schema.json");
  const codes = [
    "not_authenticated",
    "login_pending",
    "login_expired",
    "quota_exceeded",
    "invalid_request",
    "generation_failed",
    "generation_timeout",
    "backend_ai_disabled",
    "plan_not_found",
    "rate_limited",
    "backend_unreachable",
    "internal",
  ];
  for (const code of codes) {
    assert.equal(validate({ error: { code, message: "Actionable error", retryable: false } }), true, `${code}: ${JSON.stringify(validate.errors)}`);
  }
});

test("error contract rejects an unknown code", async () => {
  const validate = await compileContract("tripdremo-error.v1.schema.json");
  assert.equal(validate({
    error: { code: "unknown", message: "No", retryable: false },
  }), false);
});

test("error contract rejects extra envelope fields", async () => {
  const validate = await compileContract("tripdremo-error.v1.schema.json");
  assert.equal(validate({
    error: { code: "internal", message: "No", retryable: false },
    stack: "must-not-be-exposed",
  }), false);
});
