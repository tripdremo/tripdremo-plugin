import { randomUUID } from "node:crypto";
export const ERROR_CODES = [
    "not_authenticated", "login_pending", "login_expired", "quota_exceeded", "invalid_request",
    "generation_failed", "generation_timeout", "backend_ai_disabled", "plan_not_found", "rate_limited", "backend_unreachable", "internal",
];
export class TripdremoError extends Error {
    code;
    retryable;
    details;
    constructor(code, message, options = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "TripdremoError";
        this.code = code;
        this.retryable = options.retryable ?? false;
        this.details = code === "internal"
            ? { ...(options.details ?? {}), incident_id: options.incidentId ?? randomUUID().slice(0, 12) }
            : { ...(options.details ?? {}) };
    }
    toJson() {
        return { error: { code: this.code, message: this.message, retryable: this.retryable, details: this.details } };
    }
}
export function isTripdremoError(error) {
    return error instanceof TripdremoError;
}
//# sourceMappingURL=errors.js.map