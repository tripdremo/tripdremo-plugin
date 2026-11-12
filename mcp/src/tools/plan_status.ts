import { ApiClient } from "../api/client.js";
import { readCredential } from "../auth/store.js";
import { loadConfig } from "../config.js";
import { TripdremoError } from "../errors.js";
import { projectPlan } from "../format/summary.js";
import { resolveShareUrl } from "./helpers.js";
import type { GenerationProgress, OwnerKind, PlanStatusArg } from "./types.js";

export function currentOwnerKind(): OwnerKind {
  if (loadConfig().devUser) return "user";
  return readCredential().planType === "user" ? "user" : "guest";
}

export async function planStatus(args: PlanStatusArg, client: ApiClient) {
  if (!Number.isInteger(args.job_id) || args.job_id <= 0) {
    throw new TripdremoError("invalid_request", "job_id must be a positive integer");
  }
  const response = await client.request<GenerationProgress>("get", `/generation-jobs/${args.job_id}/progress/`);
  const job = response.generation_job ?? {};
  if (job.status === "failed") {
    const reason = job.error?.trim() || "Trip generation failed.";
    return {
      status: "failed" as const,
      error: {
        code: "generation_failed" as const,
        message: reason,
        retryable: false,
        details: { reason },
      },
    };
  }
  if (response.trip) {
    if (response.trip.status !== "ready") {
      const status = typeof response.trip.status === "string" ? response.trip.status : "missing";
      const reason = "Trip generation completed without a public-ready plan.";
      return {
        status: "failed" as const,
        error: {
          code: "generation_failed" as const,
          message: reason,
          retryable: false,
          details: { reason, status },
        },
      };
    }
    const shareHash = String(response.trip.share_hash || "");
    return {
      status: "ready" as const,
      step: job.progress_step,
      plan: projectPlan(
        { ...response.trip, share_url: resolveShareUrl(`/plans/${shareHash}`) },
        false,
        currentOwnerKind(),
      ),
    };
  }
  if (job.status === "completed") {
    const reason = "Trip generation completed without a trip result.";
    return {
      status: "failed" as const,
      error: {
        code: "generation_failed" as const,
        message: reason,
        retryable: false,
        details: { reason },
      },
    };
  }
  return {
    status: "generating" as const,
    step: job.progress_step || job.progress_status || "generating",
  };
}
