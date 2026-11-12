import { ApiClient } from "../api/client.js";
import type { OwnerKind, PlanStatusArg } from "./types.js";
export declare function currentOwnerKind(): OwnerKind;
export declare function planStatus(args: PlanStatusArg, client: ApiClient): Promise<{
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
    step: string | undefined;
    plan: import("./types.js").PlanResult;
    error?: never;
} | {
    status: "generating";
    step: string;
    error?: never;
    plan?: never;
}>;
//# sourceMappingURL=plan_status.d.ts.map