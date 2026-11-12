import { ApiClient } from "../api/client.js";
import { currentOwnerKind } from "./plan_status.js";
import { resolveShareUrl } from "./helpers.js";
import { projectPlan } from "../format/summary.js";
import { TripdremoError } from "../errors.js";

export async function savePlanToAccount(args: { share_hash: string }, client: ApiClient) {
  const shareHash = String(args.share_hash || "").trim();
  if (!shareHash) throw new TripdremoError("invalid_request", "share_hash is required");
  if (currentOwnerKind() !== "user") {
    throw new TripdremoError("not_authenticated", "Tripdremo authentication is required.", {
      details: { required: "authenticated_user", action: "tripdremo_login" },
    });
  }
  const encodedHash = encodeURIComponent(shareHash);
  const response = await client.request<Record<string, unknown>>("post", `/share/${encodedHash}/save/`, {});
  const plan = projectPlan({ ...(response as Record<string, unknown>), share_url: resolveShareUrl(`/plans/${encodedHash}`) }, false, "user");
  return { plan };
}
