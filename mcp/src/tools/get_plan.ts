import { ApiClient } from "../api/client.js";
import { TripdremoError } from "../errors.js";
import { projectPlan } from "../format/summary.js";
import { resolveShareUrl } from "./helpers.js";
import { currentOwnerKind } from "./plan_status.js";
import type { ShareArg } from "./types.js";

export async function getPlan(args: ShareArg, client: ApiClient) {
  const shareHash = String(args.share_hash || "").trim();
  if (!shareHash) throw new TripdremoError("invalid_request", "share_hash is required");
  const response = await client.requestAnonymous<Record<string, unknown>>("get", `/share/${encodeURIComponent(shareHash)}/`);
  const trip = response.trip && typeof response.trip === "object" ? response.trip as Record<string, unknown> : response;
  return {
    plan: projectPlan(
      { ...trip, share_hash: String(trip.share_hash || shareHash), share_url: resolveShareUrl(`/plans/${encodeURIComponent(shareHash)}`) },
      args.include_payload === true,
      currentOwnerKind(),
    ),
  };
}
