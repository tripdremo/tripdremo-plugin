import { ApiClient } from "../api/client.js";
export type LoginStartResponse = {
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
};
export type LoginWaitResult = {
    status: "approved";
    email?: string;
    claimed_plans?: Array<{
        share_hash: string;
        title: string;
    }>;
} | {
    status: "pending";
} | {
    status: "expired";
};
export declare function startLogin(client: ApiClient, openBrowser?: boolean): Promise<LoginStartResponse>;
export declare function waitForLogin(client: ApiClient, timeoutSeconds?: number): Promise<LoginWaitResult>;
export declare function resolveVerificationUri(verificationUri: string, locale?: string): {
    verification_uri: string;
    verification_uri_complete: string;
};
//# sourceMappingURL=device.d.ts.map