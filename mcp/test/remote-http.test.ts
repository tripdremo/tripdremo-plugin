import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRemoteHttpServer } from "../src/remote/http.js";
import { MCP_RESOURCE, READ_SCOPE, WRITE_SCOPE, loadRemoteConfig, type RemoteConfig } from "../src/remote/config.js";

const gateway = "gateway-test-secret-with-at-least-32-characters";
const submissionId = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const planRequest = { prompt: "Plan a quiet weekend", start_date: "2027-07-04", end_date: "2027-07-05" };
const rawPlan = {
  status: "ready", share_hash: "saved123", title: "Quiet weekend", subtitle: "Two days", destination: "Vilnius",
  dates: { start: "2027-07-04", end: "2027-07-05" },
  share_url: "/plans/saved123",
  trip_payload: { data: { days: [{ day: 1, title: "Old Town", places: [], drive: { estimate: "0 min" } }] } },
};

type Hit = { path: string; authorization: string | undefined; gateway: string | string[] | undefined; body: Record<string, unknown> };

async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function fixture() {
  const hits: Hit[] = [];
  let slowAdapters = false;
  let rejectIntrospection = false;
  let revision = false;
  const backend = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const hit = { path: req.url ?? "", authorization: req.headers.authorization, gateway: req.headers["x-tripdremo-gateway"], body };
    hits.push(hit);
    const send = (status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (hit.path === "/api/v1/oauth/internal/token-check/") {
      assert.equal(hit.authorization, undefined);
      assert.equal(hit.gateway, gateway);
      if (body.token === "slow-auth") { await new Promise((resolve) => setTimeout(resolve, 150)); }
      if (rejectIntrospection) return send(500, { error: "private failure" });
      return send(200, {
        active: !["revoked", "local-guest"].includes(body.token), subject: body.token === "user-b" ? "2" : "1", client_id: "test-client",
        audience: body.token === "wrong-audience" ? "https://mcp.tripdremo.com/mcp/extra" : MCP_RESOURCE,
        scopes: body.token === "read-only" ? [READ_SCOPE] : body.token === "write-only" ? [WRITE_SCOPE] : body.token === "no-scopes" ? [] : [READ_SCOPE, WRITE_SCOPE],
        expires_at: body.token === "string-expiry" ? new Date(Date.now() + 60_000).toISOString() : Math.floor(Date.now() / 1000) + (body.token === "expired" ? -10 : 600),
      });
    }
    assert.ok(hit.path.startsWith("/api/v1/mcp/"), "credentials may only reach MCP adapters");
    assert.equal(hit.gateway, gateway);
    if (slowAdapters) await new Promise((resolve) => setTimeout(resolve, 150));
    if (hit.path === "/api/v1/mcp/auth-status/") return send(200, { authenticated: true, subject: hit.authorization === "Bearer user-b" ? "2" : "1" });
    if (hit.path === "/api/v1/mcp/schema/") return send(200, { name: "Trip Plan v3", version: "trip-plan.v3", schema: { type: "object" }, sha256: "c".repeat(64) });
    if (hit.path === "/api/v1/mcp/submissions/prepare/") return send(201, { status: "prepared", submission_id: submissionId, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() });
    if (hit.path === "/api/v1/mcp/submissions/") return revision
      ? send(422, { status: "needs_revision", schema_version: "trip-plan.v3", plan: body.plan, issues: [{ code: "missing_title", path: "$.title", message: "Add a title" }] })
      : send(201, rawPlan);
    if (hit.path === `/api/v1/mcp/submissions/${submissionId}/`) return send(200, { submission_id: submissionId, status: "ready", result: rawPlan });
    if (hit.path === "/api/v1/mcp/submissions/?limit=20") return send(200, { operations: [{ submission_id: submissionId, status: "ready", result: rawPlan }] });
    if (hit.path === "/api/v1/mcp/plans/saved123/") return send(200, { trip: rawPlan });
    if (hit.path.startsWith("/api/v1/mcp/plans/?")) return send(200, { count: 2, next: "http://private-backend/api/v1/mcp/plans/?page=2", previous: null, results: [rawPlan] });
    return send(404, { code: "not_found" });
  });
  const backendUrl = await listen(backend);
  const config: RemoteConfig = {
    backendBaseUrl: `${backendUrl}/api/v1`, gatewaySecret: gateway,
    allowedHosts: ["mcp.tripdremo.com"], allowedOrigins: ["https://chatgpt.com"],
    backendTimeoutMs: 50, introspectionTimeoutMs: 50, host: "127.0.0.1", port: 3000,
  };
  const http = createRemoteHttpServer(config);
  const url = await listen(http);
  config.allowedHosts.push(new URL(url).host);
  const clients: Client[] = [];
  return {
    hits, url, config,
    slowAdapters: () => { slowAdapters = true; },
    rejectIntrospection: () => { rejectIntrospection = true; },
    revision: () => { revision = true; },
    async client(token = "user-a") {
      const client = new Client({ name: "remote-http-test", version: "1.0.0" });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      return client;
    },
    async request(token?: string, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers = {}) {
      return fetch(`${url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
    },
    async close() { await Promise.all(clients.map((client) => client.close())); await close(http); await close(backend); },
  };
}

test("remote metadata, OAuth challenge, health and Host/Origin checks use canonical URLs", async () => {
  const f = await fixture();
  try {
    const response = await fetch(`${f.url}/.well-known/oauth-protected-resource/mcp`);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), { resource: MCP_RESOURCE, authorization_servers: ["https://tripdremo.com"], scopes_supported: [READ_SCOPE, WRITE_SCOPE], bearer_methods_supported: ["header"], resource_name: "Tripdremo", resource_documentation: "https://tripdremo.com/en/connect-ai" });
    assert.equal((await fetch(`${f.url}/health`)).status, 200);
    assert.equal((await f.request(undefined)).status, 401);
    assert.match((await f.request(undefined)).headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/mcp.tripdremo.com\/.well-known\/oauth-protected-resource\/mcp"/);
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${f.url}/mcp`, { method: "POST", headers: { Host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject); req.end();
    });
    assert.equal(invalidHost, 403);
    assert.equal((await f.request("user-a", undefined, { Origin: "https://evil.example" })).status, 403);
    assert.equal(f.hits.length, 0);
    const cors = await f.request("user-a", undefined, { Origin: "https://chatgpt.com" });
    assert.equal(cors.status, 200);
    assert.equal(cors.headers.get("access-control-allow-origin"), "https://chatgpt.com");
    assert.equal(cors.headers.get("mcp-session-id"), null);
  } finally { await f.close(); }
});

test("actual HTTP MCP transport isolates users and advertises only seven tools", async () => {
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([f.client("user-a"), f.client("user-b")]);
    const listed = await a.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["auth_status", "get_plan", "get_plan_schema", "list_plans", "prepare_submission", "submission_status", "submit_plan"].map((name) => `tripdremo_${name}`).sort());
    const submit = listed.tools.find((tool) => tool.name === "tripdremo_submit_plan");
    assert.ok(submit?.inputSchema.required?.includes("submission_id"));
    const [ar, br] = await Promise.all([a.callTool({ name: "tripdremo_auth_status" }), b.callTool({ name: "tripdremo_auth_status" })]);
    assert.equal(ar.structuredContent?.subject, "1"); assert.equal(br.structuredContent?.subject, "2");
    const unknown = await a.callTool({ name: "tripdremo_login_start" });
    assert.equal(unknown.isError, true);
    assert.equal(f.hits.filter((hit) => hit.path.endsWith("/auth-status/")).length, 2);
    assert.ok(f.hits.filter((hit) => hit.path.includes("/mcp/")).every((hit) => ["Bearer user-a", "Bearer user-b"].includes(hit.authorization ?? "")));
    assert.match(a.getInstructions() ?? "", /submission_status/);
  } finally { await f.close(); }
});

test("remote auth fails closed on revoked, expired, wrong-audience, wrong-type expiry and insufficient scopes", async () => {
  const f = await fixture();
  try {
    for (const token of ["revoked", "local-guest", "expired", "wrong-audience", "string-expiry"]) assert.equal((await f.request(token)).status, 401, token);
    assert.equal((await f.request("no-scopes")).status, 403);
    assert.equal((await f.request("write-only")).status, 403);
    const forbidden = await f.request("read-only", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "tripdremo_prepare_submission", arguments: { request: planRequest } } });
    assert.equal(forbidden.status, 403);
    assert.match(forbidden.headers.get("www-authenticate") ?? "", /scope="trips:write"/);
    assert.equal(f.hits.some((hit) => hit.path.includes("/mcp/")), false);
    assert.equal((await f.request("slow-auth")).status, 503);
    f.rejectIntrospection(); assert.equal((await f.request("user-a")).status, 503);
  } finally { await f.close(); }
});

test("prepare-submit-replay-status forwards the same UUID and payload and projects real share links", async () => {
  const f = await fixture();
  try {
    const client = await f.client();
    await client.callTool({ name: "tripdremo_get_plan_schema" });
    const prep = await client.callTool({ name: "tripdremo_prepare_submission", arguments: { request: planRequest } });
    assert.equal(prep.structuredContent?.submission_id, submissionId);
    const args = { submission_id: submissionId, schema_version: "trip-plan.v3", request: planRequest, plan: { title: "Retained itinerary" } };
    const first = await client.callTool({ name: "tripdremo_submit_plan", arguments: args });
    const replay = await client.callTool({ name: "tripdremo_submit_plan", arguments: args });
    assert.deepEqual(first.structuredContent, replay.structuredContent);
    assert.equal((first.structuredContent?.plan as Record<string, unknown>).share_url, "https://tripdremo.com/en/plans/saved123");
    const writes = f.hits.filter((hit) => hit.path === "/api/v1/mcp/submissions/");
    assert.equal(writes.length, 2); assert.deepEqual(writes[0]?.body, writes[1]?.body);
    assert.equal(writes[0]?.body.submission_id, submissionId);
    const recovered = await client.callTool({ name: "tripdremo_submission_status", arguments: { submission_id: submissionId } });
    assert.equal((recovered.structuredContent?.result as Record<string, unknown>).status, "ready");
    const recent = await client.callTool({ name: "tripdremo_submission_status" });
    assert.equal((recent.structuredContent?.operations as unknown[]).length, 1);
    const compact = await client.callTool({ name: "tripdremo_get_plan", arguments: { share_hash: "saved123" } });
    assert.equal((compact.structuredContent?.plan as Record<string, unknown>).trip_payload, undefined);
    const full = await client.callTool({ name: "tripdremo_get_plan", arguments: { share_hash: "saved123", include_payload: true } });
    assert.ok((full.structuredContent?.plan as Record<string, unknown>).trip_payload);
    const plans = await client.callTool({ name: "tripdremo_list_plans", arguments: { limit: 1, page: 1 } });
    assert.equal(plans.structuredContent?.next_page, 2);
    assert.equal(JSON.stringify(plans).includes("private-backend"), false);
    f.revision(); const repair = await client.callTool({ name: "tripdremo_submit_plan", arguments: args });
    assert.equal(repair.isError, undefined); assert.equal(repair.structuredContent?.status, "needs_revision");
    const before = f.hits.length;
    assert.equal((await client.callTool({ name: "tripdremo_submit_plan", arguments: { ...args, submission_id: undefined } })).isError, true);
    assert.equal((await client.callTool({ name: "tripdremo_get_plan", arguments: { share_hash: "../auth-status" } })).isError, true);
    assert.ok(f.hits.slice(before).every((hit) => hit.path.includes("token-check")));
  } finally { await f.close(); }
});

test("adapter timeout returns recovery guidance without disclosing delegated credentials", async () => {
  const f = await fixture();
  try {
    const client = await f.client(); f.slowAdapters();
    const response = await client.callTool({ name: "tripdremo_submit_plan", arguments: { submission_id: submissionId, schema_version: "trip-plan.v3", request: planRequest, plan: {} } });
    assert.equal(response.isError, true);
    assert.equal((response.structuredContent?.error as Record<string, unknown>).code, "backend_unreachable");
    assert.equal((response.structuredContent?.error as Record<string, unknown>).retryable, true);
    assert.equal(JSON.stringify(response).includes("user-a"), false);
    assert.equal(JSON.stringify(response).includes(gateway), false);
  } finally { await f.close(); }
});

test("remote configuration requires a gateway credential and an exact API base", () => {
  assert.throws(() => loadRemoteConfig({}), /GATEWAY_SECRET/);
  assert.throws(() => loadRemoteConfig({ TRIPDREMO_MCP_GATEWAY_SECRET: gateway, TRIPDREMO_REMOTE_BACKEND_URL: "https://example.com/api/v1?forward=secret" }), /API base/);
  assert.throws(() => loadRemoteConfig({ TRIPDREMO_MCP_GATEWAY_SECRET: gateway, TRIPDREMO_REMOTE_BACKEND_URL: "https://other-service.example/api/v1" }), /private API service/);
  assert.equal(loadRemoteConfig({ TRIPDREMO_MCP_GATEWAY_SECRET: gateway }).backendBaseUrl, "http://srv-captain--tripdremo-api-be:8000/api/v1");
});

test("authenticated hostile collections, nesting and JSON-RPC batches are rejected before validation", async () => {
  const f = await fixture();
  try {
    const collection = Object.fromEntries(Array.from({ length: 20_001 }, (_, i) => [`k${i}`, false]));
    assert.equal((await f.request("user-a", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tripdremo_submit_plan", arguments: collection } })).status, 413);
    let deep: unknown = {}; for (let i = 0; i < 66; i++) deep = { child: deep };
    assert.equal((await f.request("user-a", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tripdremo_submit_plan", arguments: deep } })).status, 413);
    assert.equal((await f.request("user-a", [{ jsonrpc: "2.0", id: 1, method: "tools/list" }])).status, 400);
    assert.equal(f.hits.some((hit) => hit.path.includes("/mcp/")), false);
    assert.equal((await f.request("user-a")).status, 200, "a valid request still succeeds after hostile inputs");
  } finally { await f.close(); }
});
