import { loadConfig } from "../config.js";
import { readCredential, readPlans } from "../auth/store.js";
export async function authStatus() {
    const config = loadConfig();
    const state = readCredential();
    const planFiles = await readPlans();
    const authenticated = Boolean(config.devUser) || Boolean(state.token);
    const kind = config.devUser ? "user" : state.token ? (state.planType || "guest") : "none";
    const isGuest = kind === "guest";
    return {
        authenticated,
        kind: (authenticated ? kind : "none"),
        ...(state.email ? { email: state.email } : {}),
        device_id: state.deviceId,
        ...(isGuest
            ? {
                plans_used: planFiles.length,
                plans_limit: 1,
            }
            : kind === "user" ? { plans_limit: 3 } : {}),
        api_base_url: config.apiBaseUrl,
    };
}
//# sourceMappingURL=auth_status.js.map