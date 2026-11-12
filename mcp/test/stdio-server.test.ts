import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedTools = [
  "tripdremo_auth_status", "tripdremo_create_plan", "tripdremo_get_plan", "tripdremo_get_plan_schema", "tripdremo_list_plans",
  "tripdremo_login_start", "tripdremo_login_wait", "tripdremo_logout", "tripdremo_plan_status",
  "tripdremo_save_plan_to_account", "tripdremo_submit_plan",
];
const forbiddenCredentialParameters = new Set(["access_token", "client_secret", "otp", "password", "refresh_token", "token"]);

function propertyNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(propertyNames);
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const ownProperties = record.properties && typeof record.properties === "object"
    ? Object.keys(record.properties as Record<string, unknown>)
    : [];
  return [...ownProperties, ...Object.values(record).flatMap(propertyNames)];
}

function assertInvalidRequest(result: Awaited<ReturnType<Client["callTool"]>>): void {
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent && (result.structuredContent as { error?: unknown }).error && {
    code: (result.structuredContent as { error: { code: unknown } }).error.code,
    retryable: (result.structuredContent as { error: { retryable: unknown } }).error.retryable,
  }, { code: "invalid_request", retryable: false });
  const text = result.content.find((item) => item.type === "text");
  assert.ok(text && text.type === "text");
  assert.equal(JSON.parse(text.text).error.code, "invalid_request");
}

test("stdio server handshakes and advertises exactly the safe v1 tools", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "tripdremo-mcp-test-"));
  const issuedToken = ["cli", "stdio", "guest", "last"].join("_");
  const backendRoutes: string[] = [];
  const submissionIds: string[] = [];
  let submissionCount = 0;
  const backend = createServer(async (request, response) => {
    const route = request.url ?? "";
    backendRoutes.push(route);
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "GET" && route === "/api/v1/agent/schemas/trip-plan/v3/") {
      assert.equal(request.headers.authorization, undefined);
      return send(200, {
        name: "Trip Plan v3",
        version: "trip-plan.v3",
        sha256: "c".repeat(64),
        schema: { type: "object", required: ["trip", "days"] },
      });
    }
    if (request.method === "POST" && route === "/api/v1/cli/auth/device/") {
      assert.equal(request.headers.authorization, undefined);
      return send(200, {
        cli_token: issuedToken,
        device_code: "stdio-device",
        user_code: "STDIO-1",
        verification_uri: "https://tripdremo.com/en/cli/authorize",
        verification_uri_complete: "https://tripdremo.com/en/cli/authorize?code=STDIO-1",
        expires_in: 300,
        interval: 5,
      });
    }
    if (request.method === "POST" && route === "/api/v1/trips/agent-submit/") {
      assert.equal(request.headers.authorization, `Bearer ${issuedToken}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      assert.match(String(envelope.submission_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      submissionIds.push(String(envelope.submission_id));
      submissionCount += 1;
      if (submissionCount === 1) {
        return send(422, {
          status: "needs_revision",
          schema_version: "trip-plan.v3",
          issues: [{ path: "$.days[0].title", code: "required", message: "Title is required", suggestion: "Add a title.", prompt: "internal" }],
          plan: { trip: { title: "Dolomites" }, days: [{}] },
          debug: { authorization: `Bearer ${issuedToken}` },
        });
      }
      return send(201, {
        share_hash: "stdio123",
        share_url: "/plans/stdio123",
        title: "Dolomites",
        subtitle: "Locally authored",
        destination: "Dolomites",
        dates: { start: "2026-07-04", end: "2026-07-05" },
        status: "ready",
        trip_payload: { data: { days: [{ day: 1, title: "Ortisei", places: [], drive: { estimate: "0 min" } }] } },
      });
    }
    if (request.method === "POST" && route === "/api/v1/trips/agent-generate/") {
      return send(503, { code: "backend_ai_disabled", detail: "Agent cloud generation is disabled." });
    }
    return send(500, { detail: `Unexpected route ${route}` });
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const address = backend.address();
  assert.ok(address && typeof address === "object");
  const stderrChunks: Buffer[] = [];
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("bin/tripdremo-mcp.mjs")],
    cwd: path.resolve("."),
    env: {
      ...env,
      TRIPDREMO_CONFIG_DIR: configDir,
      TRIPDREMO_LOG_LEVEL: "silent",
      TRIPDREMO_API_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`,
      TRIPDREMO_SITE_URL: "https://tripdremo.com",
      TRIPDREMO_LOCALE: "en",
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  const client = new Client({ name: "tripdremo-stdio-test", version: "0.1.0" });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((tool) => tool.name).sort(), expectedTools);
    for (const tool of result.tools) {
      assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} input must be strict`);
      const forbidden = propertyNames(tool.inputSchema).filter((name) => forbiddenCredentialParameters.has(name));
      assert.deepEqual(forbidden, [], `${tool.name} must not advertise credential input fields`);
      for (const [field, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        assert.equal(typeof (schema as { description?: unknown }).description, "string", `${tool.name}.${field} needs a description`);
      }
    }
    const authStatusTool = result.tools.find((tool) => tool.name === "tripdremo_auth_status");
    assert.deepEqual(authStatusTool?.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    assertInvalidRequest(await client.callTool({
      name: "tripdremo_auth_status",
      arguments: { password: "must-never-enter-a-handler" },
    }));
    assertInvalidRequest(await client.callTool({
      name: "tripdremo_list_plans",
      arguments: { limit: "twenty" },
    }));
    assertInvalidRequest(await client.callTool({
      name: "tripdremo_submit_plan",
      arguments: {
        schema_version: "trip-plan.v3",
        request: { prompt: "Plan locally", start_date: "2026-07-04", end_date: "2026-07-05", wait_seconds: 30 },
        plan: {},
      },
    }));
    assertInvalidRequest(await client.callTool({
      name: "tripdremo_submit_plan",
      arguments: {
        submission_id: "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
        schema_version: "trip-plan.v3",
        request: { prompt: "Plan locally", start_date: "2026-07-04", end_date: "2026-07-05" },
        plan: {},
      },
    }));

    const liveSchema = await client.callTool({ name: "tripdremo_get_plan_schema", arguments: {} });
    assert.equal(liveSchema.isError, undefined);
    assert.deepEqual(liveSchema.structuredContent, {
      name: "Trip Plan v3",
      version: "trip-plan.v3",
      sha256: "c".repeat(64),
      schema: { type: "object", required: ["trip", "days"] },
    });

    const submissionArguments = {
      schema_version: "trip-plan.v3",
      request: { prompt: "Plan locally", start_date: "2026-07-04", end_date: "2026-07-05" },
      plan: { trip: { title: "Dolomites" }, days: [{}] },
    };
    const revision = await client.callTool({ name: "tripdremo_submit_plan", arguments: submissionArguments });
    assert.equal(revision.isError, undefined);
    assert.deepEqual(revision.structuredContent, {
      status: "needs_revision",
      schema_version: "trip-plan.v3",
      issues: [{ path: "$.days[0].title", code: "required", message: "Title is required", suggestion: "Add a title." }],
      plan: { trip: { title: "Dolomites" }, days: [{}] },
    });
    assert.equal(JSON.stringify(revision.structuredContent).includes(issuedToken), false);

    const ready = await client.callTool({ name: "tripdremo_submit_plan", arguments: submissionArguments });
    assert.equal(ready.isError, undefined);
    assert.equal((ready.structuredContent as { status?: unknown }).status, "ready");
    assert.equal((ready.structuredContent as { plan?: { share_url?: unknown } }).plan?.share_url, "https://tripdremo.com/en/plans/stdio123");

    const disabled = await client.callTool({
      name: "tripdremo_create_plan",
      arguments: { prompt: "Use cloud AI", start_date: "2026-07-04", end_date: "2026-07-05" },
    });
    assert.equal(disabled.isError, true);
    assert.deepEqual((disabled.structuredContent as { error?: unknown }).error && {
      code: (disabled.structuredContent as { error: { code: unknown } }).error.code,
      retryable: (disabled.structuredContent as { error: { retryable: unknown } }).error.retryable,
    }, { code: "backend_ai_disabled", retryable: false });
    assert.equal(backendRoutes.includes("/api/v1/trips/generate/"), false);
    assert.equal(backendRoutes.filter((route) => route === "/api/v1/trips/agent-generate/").length, 1);
    assert.equal(submissionIds.length, 2);
    assert.notEqual(submissionIds[0], submissionIds[1]);
  } finally {
    await client.close();
    backend.close();
    await once(backend, "close");
    await rm(configDir, { recursive: true, force: true });
  }
  assert.equal(Buffer.concat(stderrChunks).toString("utf8"), "");
});
