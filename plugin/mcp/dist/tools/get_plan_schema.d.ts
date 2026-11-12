import { ApiClient } from "../api/client.js";
export type PlanSchemaResult = {
    name: string;
    version: "trip-plan.v3";
    sha256: string;
    schema: Record<string, unknown>;
};
export declare function getPlanSchema(client: ApiClient): Promise<PlanSchemaResult>;
//# sourceMappingURL=get_plan_schema.d.ts.map