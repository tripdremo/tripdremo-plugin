export type GenerateArgs = {
    prompt: string;
    origin?: string;
    destination?: string;
    start_date: string;
    end_date: string;
    adults?: number;
    children?: {
        age: number;
    }[];
    style?: "relaxed" | "balanced" | "active" | "camper" | "luxury";
    budget?: "value" | "comfortable" | "premium";
    constraints?: Record<string, unknown>;
    wait_seconds?: number;
};
export type PlanRequest = Omit<GenerateArgs, "wait_seconds">;
export type SubmitPlanArgs = {
    schema_version: "trip-plan.v3";
    request: PlanRequest;
    plan: Record<string, unknown>;
};
export type PlanStatusArg = {
    job_id: number;
};
export type ShareArg = {
    share_hash: string;
    include_payload?: boolean;
};
export type ListPlansArg = {
    limit?: number;
};
export type SaveArg = {
    share_hash: string;
};
export type PlanDay = {
    index: number;
    title: string;
    stop_count: number;
    drive_summary: string;
};
export type PlanResult = {
    share_hash: string;
    share_url: string;
    title: string;
    subtitle: string;
    destination: string;
    dates: {
        start: string;
        end: string;
    };
    day_count: number;
    status: "draft" | "generating" | "ready" | "failed";
    owner_kind: OwnerKind;
    days: PlanDay[];
    trip_payload?: Record<string, unknown>;
};
export type GenerationJob = {
    id?: number;
    status?: string;
    progress_status?: string;
    progress_step?: string;
    error?: string;
};
export type GenerationProgress = {
    generation_job?: GenerationJob;
    trip?: Record<string, unknown>;
};
export type OwnerKind = "guest" | "user";
//# sourceMappingURL=types.d.ts.map