import type { OwnerKind, PlanResult } from "../tools/types.js";
export type RawDay = {
    day?: number;
    index?: number;
    title?: string;
    places?: unknown[];
    stop_count?: number;
    drive?: {
        from?: string;
        to?: string;
        estimate?: string;
        distance_km?: number;
    };
    drive_summary?: string;
};
export type RawPlan = {
    title?: string;
    subtitle?: string;
    destination?: string;
    dates?: {
        start?: string;
        end?: string;
    };
    status?: string;
    share_hash?: string;
    share_url?: string;
    owner_kind?: OwnerKind;
    trip_payload?: {
        data?: {
            days?: RawDay[];
        };
    };
};
export declare function compactLineCount(days: Array<RawDay | unknown>, max?: number): string[];
export declare function projectPlan(raw: RawPlan, includePayload?: boolean, ownerKind?: OwnerKind): PlanResult;
//# sourceMappingURL=summary.d.ts.map