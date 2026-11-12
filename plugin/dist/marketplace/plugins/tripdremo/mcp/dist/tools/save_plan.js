import { currentOwnerKind } from "./plan_status.js";
import { resolveShareUrl } from "./helpers.js";
import { projectPlan } from "../format/summary.js";
import { TripdremoError } from "../errors.js";
export async function savePlanToAccount(args, client) {
    const shareHash = String(args.share_hash || "").trim();
    if (!shareHash)
        throw new TripdremoError("invalid_request", "share_hash is required");
    if (currentOwnerKind() !== "user") {
        throw new TripdremoError("not_authenticated", "Tripdremo authentication is required.", {
            details: { required: "authenticated_user", action: "tripdremo_login" },
        });
    }
    const encodedHash = encodeURIComponent(shareHash);
    const response = await client.request("post", `/share/${encodedHash}/save/`, {});
    const plan = projectPlan({ ...response, share_url: resolveShareUrl(`/plans/${encodedHash}`) }, false, "user");
    return { plan };
}
//# sourceMappingURL=save_plan.js.map