import { ApiClient } from "../api/client.js";
import type { SubmitPlanArgs } from "./types.js";
type RevisionIssue = {
    path: string;
    code: string;
    message: string;
    suggestion?: string;
};
export declare function submitPlan(args: SubmitPlanArgs, client: ApiClient): Promise<{
    status: "needs_revision";
    schema_version: string;
    issues: RevisionIssue[];
    plan: Record<string, unknown>;
} | {
    status: "ready";
    plan: import("./types.js").PlanResult;
}>;
export {};
//# sourceMappingURL=submit_plan.d.ts.map