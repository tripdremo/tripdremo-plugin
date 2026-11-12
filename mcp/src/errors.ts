import { randomUUID } from "node:crypto";

export const ERROR_CODES = [
  "not_authenticated", "login_pending", "login_expired", "quota_exceeded", "invalid_request",
  "generation_failed", "generation_timeout", "backend_ai_disabled", "plan_not_found", "rate_limited", "backend_unreachable", "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorDetails = Record<string, unknown>;
export type TripdremoErrorPayload = {
  error: { code: ErrorCode; message: string; retryable: boolean; details: ErrorDetails };
};

type ErrorOptions = { retryable?: boolean; details?: ErrorDetails; incidentId?: string; cause?: unknown };

export class TripdremoError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, options: ErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TripdremoError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = code === "internal"
      ? { ...(options.details ?? {}), incident_id: options.incidentId ?? randomUUID().slice(0, 12) }
      : { ...(options.details ?? {}) };
  }

  toJson(): TripdremoErrorPayload {
    return { error: { code: this.code, message: this.message, retryable: this.retryable, details: this.details } };
  }
}

export function isTripdremoError(error: unknown): error is TripdremoError {
  return error instanceof TripdremoError;
}
