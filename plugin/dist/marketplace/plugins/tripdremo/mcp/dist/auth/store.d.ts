export type AuthKind = "guest" | "user";
export type StoredLogin = {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
    started_at: string;
};
export type StoredCredential = {
    token?: string;
    email?: string;
    userCode?: string;
    createdAt?: string;
    planType?: AuthKind;
    deviceId: string;
    login?: StoredLogin | null;
};
export type StoredPlanRef = {
    share_hash: string;
    title: string;
    created_at: string;
};
export type PendingSubmission = {
    submission_id: string;
    payload_hash: string;
    identity_hash: string;
    created_at: string;
};
export declare const PENDING_SUBMISSION_MAX_AGE_MS: number;
export declare function redactedToken(token?: string): string;
export declare function ensureDeviceId(): string;
export declare function readCredential(): StoredCredential;
export declare function writeCredential(payload: Partial<StoredCredential>): void;
export declare function deleteCredential(): void;
export declare function currentSubmissionIdentityHash(): string;
export declare function writePendingSubmission(pending: PendingSubmission): void;
export declare function readPendingSubmission(identityHash: string, nowMs?: number): PendingSubmission | undefined;
export declare function deletePendingSubmission(): void;
export declare function writePendingRevocation(token: string): void;
export declare function readPendingRevocation(): string | undefined;
export declare function deletePendingRevocation(): void;
export declare function readDeviceHeaders(): {
    "X-Tripdremo-Device-Id": string;
};
export declare function hasToken(): Promise<boolean>;
export declare function getToken(): string | undefined;
export declare function setToken(token: string, kind?: AuthKind): void;
export declare function setAuthMeta(meta: {
    email?: string;
    userCode?: string;
    login?: StoredLogin | null;
    planType?: AuthKind;
}): void;
export declare function readPlans(): Promise<StoredPlanRef[]>;
export declare function writePlans(plans: StoredPlanRef[]): void;
export declare function appendPlan(plan: Omit<StoredPlanRef, "created_at">): void;
//# sourceMappingURL=store.d.ts.map