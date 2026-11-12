export declare const ERROR_CODES: readonly ["not_authenticated", "login_pending", "login_expired", "quota_exceeded", "invalid_request", "generation_failed", "generation_timeout", "backend_ai_disabled", "plan_not_found", "rate_limited", "backend_unreachable", "internal"];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ErrorDetails = Record<string, unknown>;
export type TripdremoErrorPayload = {
    error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
        details: ErrorDetails;
    };
};
type ErrorOptions = {
    retryable?: boolean;
    details?: ErrorDetails;
    incidentId?: string;
    cause?: unknown;
};
export declare class TripdremoError extends Error {
    readonly code: ErrorCode;
    readonly retryable: boolean;
    readonly details: ErrorDetails;
    constructor(code: ErrorCode, message: string, options?: ErrorOptions);
    toJson(): TripdremoErrorPayload;
}
export declare function isTripdremoError(error: unknown): error is TripdremoError;
export {};
//# sourceMappingURL=errors.d.ts.map