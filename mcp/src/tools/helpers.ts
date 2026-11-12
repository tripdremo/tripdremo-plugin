import { loadConfig } from "../config.js";
import { ERROR_CODES, TripdremoError } from "../errors.js";

const SENSITIVE_KEY = /authorization|cookie|token|api[-_]?key/i;
const TOKEN_IN_TEXT = /\bBearer\s+[^\s,;"']+|\bcli_[A-Za-z0-9._~-]+\b/gi;

export function resolveShareUrl(relativeSharePath: string): string {
  const config = loadConfig();
  const relativePath = relativeSharePath.startsWith("/") ? relativeSharePath : `/${relativeSharePath}`;
  return `${config.siteUrl}/${config.locale}${relativePath}`;
}

export function withRedactedToken(token: string): string {
  const clean = token.trim();
  if (!clean) return "none";
  const prefix = clean.startsWith("cli_") ? "cli_" : clean.slice(0, Math.min(3, clean.length));
  const suffix = clean.length > 4 ? clean.slice(-4) : "";
  return `${prefix}…${suffix}`;
}

export function redactSensitive(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(TOKEN_IN_TEXT, (token) => withRedactedToken(token.replace(/^Bearer\s+/i, "")));
  }
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (typeof value !== "object" || value === null) return value;
  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(nested);
  }
  return redacted;
}

export function parseJsonSafely<T>(value: unknown): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TripdremoError("internal", "Malformed backend payload", {
      details: { received_type: Array.isArray(value) ? "array" : typeof value },
    });
  }
  return value as T;
}

export function assertLocale(value: unknown): asserts value is "en" | "lt" | "de" | "pl" {
  if (!(["en", "lt", "de", "pl"] as unknown[]).includes(value)) throw new TripdremoError("invalid_request", "Invalid locale");
}

export function isTripdremoErrorCode(value: unknown): value is (typeof ERROR_CODES)[number] {
  return typeof value === "string" && ERROR_CODES.includes(value as (typeof ERROR_CODES)[number]);
}
