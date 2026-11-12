export declare function authStatus(): Promise<{
    api_base_url: string;
    plans_used: number;
    plans_limit: number;
    device_id: string;
    email?: string;
    authenticated: boolean;
    kind: string;
} | {
    api_base_url: string;
    plans_limit: number;
    device_id: string;
    email?: string;
    authenticated: boolean;
    kind: string;
} | {
    api_base_url: string;
    device_id: string;
    email?: string;
    authenticated: boolean;
    kind: string;
}>;
//# sourceMappingURL=auth_status.d.ts.map