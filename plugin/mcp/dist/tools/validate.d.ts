declare const STYLES: readonly ["relaxed", "balanced", "active", "camper", "luxury"];
declare const BUDGETS: readonly ["value", "comfortable", "premium"];
export type PlanPayload = {
    prompt: string;
    origin?: string;
    destination?: string;
    start_date: string;
    end_date: string;
    adults?: number;
    children?: {
        age: number;
    }[];
    style?: (typeof STYLES)[number];
    budget?: (typeof BUDGETS)[number];
    constraints?: Record<string, unknown>;
    wait_seconds?: number;
};
export declare function validateDateRange(startDate: string, endDate: string): void;
export declare function normalizeChildren(children: unknown): {
    age: number;
}[];
export declare function validatePromptPayload(payload: PlanPayload): void;
export {};
//# sourceMappingURL=validate.d.ts.map