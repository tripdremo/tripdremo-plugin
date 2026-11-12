import { ApiClient } from "../api/client.js";
import type { ListPlansArg } from "./types.js";
export declare function listPlans(args: ListPlansArg, client: ApiClient): Promise<{
    account: import("./types.js").PlanResult[];
    guest_local: {
        share_hash: string;
        title: string;
        share_url: string;
        created_at: string;
    }[];
}>;
//# sourceMappingURL=list_plans.d.ts.map