export const MCP_RESOURCE = "https://mcp.tripdremo.com/mcp";
export const OAUTH_ISSUER = "https://tripdremo.com";
export const READ_SCOPE = "trips:read";
export const WRITE_SCOPE = "trips:write";
export const RESOURCE_METADATA_URL = "https://mcp.tripdremo.com/.well-known/oauth-protected-resource/mcp";

export type RemoteConfig = {
  backendBaseUrl: string;
  gatewaySecret: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  backendTimeoutMs: number;
  introspectionTimeoutMs: number;
  port: number;
  host: string;
};

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadRemoteConfig(env = process.env): RemoteConfig {
  const backend = new URL(env.TRIPDREMO_REMOTE_BACKEND_URL ?? "http://srv-captain--tripdremo-api-be:8000/api/v1");
  if (!["http:", "https:"].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash || backend.pathname.replace(/\/$/, "") !== "/api/v1") {
    throw new Error("TRIPDREMO_REMOTE_BACKEND_URL must be an HTTP(S) API base ending in /api/v1 without credentials or query parameters");
  }
  const canonicalPrivate = backend.origin === "http://srv-captain--tripdremo-api-be:8000";
  const localBackend = ["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname);
  if (!canonicalPrivate && !localBackend) throw new Error("TRIPDREMO_REMOTE_BACKEND_URL must target the private API service or a local loopback backend");
  const gatewaySecret = env.TRIPDREMO_MCP_GATEWAY_SECRET ?? "";
  if (gatewaySecret.length < 32 || /\s/.test(gatewaySecret)) throw new Error("TRIPDREMO_MCP_GATEWAY_SECRET must contain at least 32 non-whitespace characters");
  const port = positiveInteger(env.PORT, 3000, "PORT");
  if (port > 65535) throw new Error("PORT must be at most 65535");
  return {
    backendBaseUrl: backend.toString().replace(/\/$/, ""),
    gatewaySecret,
    allowedHosts: (env.TRIPDREMO_MCP_ALLOWED_HOSTS ?? "mcp.tripdremo.com").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
    allowedOrigins: (env.TRIPDREMO_MCP_ALLOWED_ORIGINS ?? "https://tripdremo.com,https://chatgpt.com,https://claude.ai").split(",").map((origin) => origin.trim()).filter(Boolean),
    backendTimeoutMs: positiveInteger(env.TRIPDREMO_MCP_BACKEND_TIMEOUT_MS, 55_000, "TRIPDREMO_MCP_BACKEND_TIMEOUT_MS"),
    introspectionTimeoutMs: positiveInteger(env.TRIPDREMO_MCP_AUTH_TIMEOUT_MS, 5_000, "TRIPDREMO_MCP_AUTH_TIMEOUT_MS"),
    port,
    host: env.TRIPDREMO_MCP_BIND_HOST ?? "0.0.0.0",
  };
}
