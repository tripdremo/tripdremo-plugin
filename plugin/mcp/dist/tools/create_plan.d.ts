import { ApiClient } from "../api/client.js";
export declare function createPlan(args: Record<string, unknown>, client: ApiClient): Promise<{
    status: "failed";
    error: {
        code: "generation_failed";
        message: string;
        retryable: boolean;
        details: {
            reason: string;
            status?: never;
        };
    };
    step?: never;
    plan?: never;
} | {
    status: "failed";
    error: {
        code: "generation_failed";
        message: string;
        retryable: boolean;
        details: {
            reason: string;
            status: string;
        };
    };
    step?: never;
    plan?: never;
} | {
    status: "ready";
    plan: import("./types.js").PlanResult;
} | {
    status: "generating";
    job_id: number;
    progress_url: string;
    poll_after_seconds: number;
}>;
//# sourceMappingURL=create_plan.d.ts.map