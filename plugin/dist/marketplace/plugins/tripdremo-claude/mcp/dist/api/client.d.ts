import { type TripdremoConfig } from "../config.js";
export type ApiResponse<T> = {
    status: number;
    headers: Headers;
    body: T;
};
export type HttpMethod = "get" | "post" | "put" | "delete";
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type ApiClientOptions = {
    version?: string;
    config?: TripdremoConfig;
    fetch?: FetchLike;
    sleep?: (milliseconds: number) => Promise<void>;
    random?: () => number;
    now?: () => number;
    tokenProvider?: () => string | undefined;
};
export declare class ApiClient {
    private readonly config;
    private readonly fetchImpl;
    private readonly sleep;
    private readonly random;
    private readonly now;
    private readonly tokenProvider;
    private readonly userAgent;
    constructor(versionOrOptions?: string | ApiClientOptions);
    request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
    requestAnonymous<T>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
    requestWithToken<T>(method: HttpMethod, path: string, body: unknown, token: string): Promise<T>;
    requestWithRetry<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse<T>>;
    requestPlanSubmission<T = unknown>(body: unknown): Promise<ApiResponse<T>>;
    private requestWithRetryMode;
    rawRequest(method: "post", path: string, body?: unknown): Promise<Record<string, unknown>>;
    private headers;
    private fetchOnce;
    private parseBody;
    private retryDelay;
    private backoff;
    private errorDetails;
    private throwMappedError;
}
//# sourceMappingURL=client.d.ts.map