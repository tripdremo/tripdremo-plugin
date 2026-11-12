import { ApiClient } from "../api/client.js";
import { readPlans } from "../auth/store.js";
import { loadConfig } from "../config.js";
import { TripdremoError } from "../errors.js";
import { projectPlan } from "../format/summary.js";
import { resolveShareUrl } from "./helpers.js";
import { currentOwnerKind } from "./plan_status.js";
import type { ListPlansArg } from "./types.js";

export async function listPlans(args: ListPlansArg, client: ApiClient) {
  const limit = Number(args.limit ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TripdremoError("invalid_request", "limit must be an integer 1..100");
  }
  const local = await readPlans();
  let accountTrips: ReturnType<typeof projectPlan>[] = [];
  if (currentOwnerKind() === "user" || loadConfig().devUser) {
    let page = 1;
    while (accountTrips.length < limit) {
      const account = await client.request<{ next?: unknown; results?: Record<string, unknown>[] }>("get", `/trips/?page=${page}`);
      const results = Array.isArray(account.results) ? account.results : [];
      accountTrips.push(...results.map((trip) => {
        const shareHash = String(trip.share_hash || "");
        return projectPlan(
          { ...trip, share_url: resolveShareUrl(`/plans/${encodeURIComponent(shareHash)}`) },
          false,
          currentOwnerKind(),
        );
      }));
      if (!account.next || results.length === 0) break;
      page += 1;
    }
    accountTrips = accountTrips.slice(0, limit);
  }
  return {
    account: accountTrips,
    guest_local: local.slice(0, limit).map((entry) => ({
      share_hash: entry.share_hash,
      title: entry.title,
      share_url: resolveShareUrl(`/plans/${encodeURIComponent(entry.share_hash)}`),
      created_at: entry.created_at,
    })),
  };
}
