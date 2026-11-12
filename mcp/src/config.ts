import os from "node:os";
import path from "node:path";

const LOCALES = ["en", "lt", "de", "pl"] as const;
const LOG_LEVELS = ["silent", "error", "warn", "info", "debug"] as const;
const DEFAULTS = {
  apiBaseUrl: "https://tripdremo.com/api/v1",
  siteUrl: "https://tripdremo.com",
  locale: "en",
  timeoutMs: 30_000,
  submitTimeoutMs: 300_000,
  logLevel: "warn",
} as const;

export type Locale = (typeof LOCALES)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type TripdremoConfig = {
  apiBaseUrl: string;
  siteUrl: string;
  locale: Locale;
  configDir: string;
  devUser: string | undefined;
  timeoutMs: number;
  submitTimeoutMs: number;
  logLevel: LogLevel;
};

function parseChoice<T extends string>(name: string, raw: string | undefined, allowed: readonly T[], fallback: T): T {
  if (raw === undefined || raw === "") return fallback;
  if (allowed.includes(raw as T)) return raw as T;
  throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}

function parseAbsoluteHttpUrl(name: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error(`${name} must be an absolute HTTP(S) URL without credentials`);
  }
  if (url.search || url.hash) throw new Error(`${name} must not contain a query string or fragment`);
  return url;
}

function withoutTrailingSlashes(url: URL): string {
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function configDirectory(raw: string | undefined): string {
  if (!raw) return path.join(os.homedir(), ".tripdremo");
  const expanded = raw === "~" ? os.homedir() : raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  if (!path.isAbsolute(expanded)) throw new Error("TRIPDREMO_CONFIG_DIR must be an absolute path or start with ~/");
  return path.normalize(expanded);
}

function timeout(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TripdremoConfig {
  const apiUrl = parseAbsoluteHttpUrl("TRIPDREMO_API_BASE_URL", env.TRIPDREMO_API_BASE_URL || DEFAULTS.apiBaseUrl);
  const siteUrl = parseAbsoluteHttpUrl("TRIPDREMO_SITE_URL", env.TRIPDREMO_SITE_URL || DEFAULTS.siteUrl);
  const devUser = env.TRIPDREMO_DEV_USER?.trim() || undefined;
  if (devUser && !isLoopback(apiUrl.hostname)) {
    throw new Error("TRIPDREMO_DEV_USER is allowed only with a localhost API base URL");
  }
  return {
    apiBaseUrl: withoutTrailingSlashes(apiUrl),
    siteUrl: withoutTrailingSlashes(siteUrl),
    locale: parseChoice("TRIPDREMO_LOCALE", env.TRIPDREMO_LOCALE, LOCALES, DEFAULTS.locale),
    configDir: configDirectory(env.TRIPDREMO_CONFIG_DIR),
    devUser,
    timeoutMs: timeout("TRIPDREMO_TIMEOUT_MS", env.TRIPDREMO_TIMEOUT_MS, DEFAULTS.timeoutMs),
    submitTimeoutMs: timeout("TRIPDREMO_SUBMIT_TIMEOUT_MS", env.TRIPDREMO_SUBMIT_TIMEOUT_MS, DEFAULTS.submitTimeoutMs),
    logLevel: parseChoice("TRIPDREMO_LOG_LEVEL", env.TRIPDREMO_LOG_LEVEL, LOG_LEVELS, DEFAULTS.logLevel),
  };
}
