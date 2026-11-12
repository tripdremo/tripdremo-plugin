import { startLogin } from "../auth/device.js";
import { appendPlan, getToken } from "../auth/store.js";
import { loadConfig } from "../config.js";
import { TripdremoError } from "../errors.js";
import { projectPlan } from "../format/summary.js";
import { parseJsonSafely, resolveShareUrl } from "./helpers.js";
import { currentOwnerKind, planStatus } from "./plan_status.js";
import { validatePromptPayload } from "./validate.js";
const POLL_AFTER_SECONDS = 2;
function readyResult(detail) {
    const ownerKind = currentOwnerKind();
    const shareHash = String(detail.share_hash || "");
    const plan = projectPlan({ ...detail, share_url: resolveShareUrl(`/plans/${encodeURIComponent(shareHash)}`) }, false, ownerKind);
    if (shareHash && ownerKind === "guest") {
        appendPlan({ share_hash: shareHash, title: String(detail.title || "Plan") });
    }
    return { status: "ready", plan };
}
export async function createPlan(args, client) {
    const payload = args;
    if (payload.wait_seconds !== undefined && (!Number.isInteger(payload.wait_seconds) || payload.wait_seconds < 0 || payload.wait_seconds > 120)) {
        throw new TripdremoError("invalid_request", "wait_seconds must be integer 0..120");
    }
    validatePromptPayload(payload);
    if (!loadConfig().devUser && !getToken()) {
        await startLogin(client, false);
    }
    const response = parseJsonSafely(await client.request("post", "/trips/agent-generate/", {
        prompt: payload.prompt,
        origin: payload.origin || "",
        destination: payload.destination || "",
        start_date: payload.start_date,
        end_date: payload.end_date,
        adults: payload.adults ?? 2,
        children: payload.children ?? [],
        style: payload.style ?? "balanced",
        budget: payload.budget ?? "comfortable",
        constraints: payload.constraints || {},
    }));
    if (response.status !== "generating") {
        if (response.status !== "ready") {
            const status = typeof response.status === "string" ? response.status : "missing";
            throw new TripdremoError("generation_failed", "Trip generation did not produce a public plan.", {
                details: { reason: "The generated trip is not ready for public access.", status },
            });
        }
        return readyResult(response);
    }
    const job = response.generation_job;
    if (!Number.isInteger(job?.id) || Number(job?.id) <= 0) {
        throw new TripdremoError("internal", "Generation response did not include a valid job id");
    }
    const jobId = Number(job?.id);
    const handle = {
        status: "generating",
        job_id: jobId,
        progress_url: String(response.progress_url || `/generation-jobs/${jobId}/progress/`),
        poll_after_seconds: POLL_AFTER_SECONDS,
    };
    const waitSeconds = payload.wait_seconds ?? 0;
    if (waitSeconds === 0)
        return handle;
    const deadline = Date.now() + waitSeconds * 1_000;
    while (Date.now() < deadline) {
        const progress = await planStatus({ job_id: jobId }, client);
        if (progress.status !== "generating") {
            if (progress.status === "ready" && currentOwnerKind() === "guest") {
                appendPlan({ share_hash: progress.plan.share_hash, title: progress.plan.title || "Plan" });
            }
            return progress;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            break;
        await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_AFTER_SECONDS * 1_000, remaining)));
    }
    return handle;
}
//# sourceMappingURL=create_plan.js.map