import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { introspectToken, RemoteAuthError, RemoteBackend } from "./backend.js";
import { MCP_RESOURCE, OAUTH_ISSUER, READ_SCOPE, RESOURCE_METADATA_URL, WRITE_SCOPE, type RemoteConfig } from "./config.js";
import { createRemoteServer } from "./server.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_JSON_ELEMENTS = 20_000;
const MAX_JSON_DEPTH = 64;
const protectedResource = {
  resource: MCP_RESOURCE,
  authorization_servers: [OAUTH_ISSUER],
  scopes_supported: [READ_SCOPE, WRITE_SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "Tripdremo",
  resource_documentation: "https://tripdremo.com/en/connect-ai",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function challenge(res: ServerResponse, error: RemoteAuthError, scope = `${READ_SCOPE} ${WRITE_SCOPE}`): void {
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="${scope}", error="${error.code}"`);
  json(res, error.status, { error: error.code });
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isBoundedJson(body: unknown): boolean {
  const pending = [{ value: body, depth: 0 }];
  let elements = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (depth > MAX_JSON_DEPTH) return false;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (++elements > MAX_JSON_ELEMENTS) return false;
      pending.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
    }
  }
  return true;
}

function requiredScope(body: unknown): string {
  const rpc = body as { method?: unknown; params?: { name?: unknown } } | null;
  return rpc?.method === "tools/call" && ["tripdremo_prepare_submission", "tripdremo_submit_plan"].includes(String(rpc.params?.name)) ? WRITE_SCOPE : READ_SCOPE;
}

export function createRemoteHttpServer(config: RemoteConfig) {
  const http = createServer(async (req, res) => {
    try {
      // Match the actual Host, never a client-supplied forwarded header.
      if (!req.headers.host || !config.allowedHosts.includes(req.headers.host.toLowerCase())) {
        json(res, 403, { error: "invalid_host" }); return;
      }
      const origin = req.headers.origin;
      if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
        json(res, 403, { error: "invalid_origin" }); return;
      }
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate,MCP-Protocol-Version");
      }
      const path = req.url?.split("?")[0];
      if (req.method === "GET" && path === "/health") { json(res, 200, { status: "ok", service: "tripdremo-connect" }); return; }
      if (req.method === "GET" && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")) {
        json(res, 200, protectedResource); return;
      }
      if (path !== "/mcp") { json(res, 404, { error: "not_found" }); return; }
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST,GET,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,MCP-Protocol-Version,Mcp-Session-Id");
        res.writeHead(204); res.end(); return;
      }
      const bearer = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (!bearer || bearer.length > 4096) { challenge(res, new RemoteAuthError(401, "invalid_token")); return; }
      let identity;
      try { identity = await introspectToken(bearer, config); }
      catch (error) { challenge(res, error instanceof RemoteAuthError ? error : new RemoteAuthError(503, "temporarily_unavailable")); return; }
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST,OPTIONS");
        json(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Stateless MCP accepts POST requests." }, id: null }); return;
      }
      if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        json(res, 415, { error: "unsupported_media_type" }); return;
      }
      let body: unknown;
      try { body = await parseBody(req); }
      catch (error) {
        json(res, error instanceof Error && error.message === "body_too_large" ? 413 : 400, { error: "invalid_json_body" }); return;
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        json(res, 400, { error: "invalid_rpc_request" }); return;
      }
      if (!isBoundedJson(body)) { json(res, 413, { error: "input_too_complex" }); return; }
      const scope = requiredScope(body);
      if (!identity.scopes.includes(scope)) { challenge(res, new RemoteAuthError(403, "insufficient_scope"), scope); return; }
      const server = createRemoteServer(new RemoteBackend(bearer, config));
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: MAX_BODY_BYTES });
      res.once("close", () => { void server.close(); });
      // SDK transport accessors include undefined; its Transport interface omits it.
      await server.connect(transport as Transport);
      try { await transport.handleRequest(req, res, body); }
      catch { await server.close(); if (!res.headersSent) json(res, 500, { error: "internal_error" }); }
    } catch {
      if (!res.headersSent) json(res, 500, { error: "internal_error" });
      else res.end();
    }
  });
  http.requestTimeout = 65_000;
  http.headersTimeout = 10_000;
  return http;
}
