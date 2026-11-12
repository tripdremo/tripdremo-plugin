import { createHash, randomUUID } from "node:crypto";
import { startLogin } from "../auth/device.js";
import { appendPlan, currentSubmissionIdentityHash, deletePendingSubmission, getToken, readPendingSubmission, writePendingSubmission, } from "../auth/store.js";
import { loadConfig } from "../config.js";
import { TripdremoError } from "../errors.js";
import { projectPlan } from "../format/summary.js";
import { parseJsonSafely, redactSensitive, resolveShareUrl } from "./helpers.js";
import { currentOwnerKind } from "./plan_status.js";
import { validatePromptPayload } from "./validate.js";
function malformed(field) {
    throw new TripdremoError("internal", "Tripdremo returned a malformed plan submission response.", {
        details: { invalid_field: field },
    });
}
function revisionIssue(value, index) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        malformed(`issues[${index}]`);
    const issue = value;
    for (const field of ["path", "code", "message"]) {
        if (typeof issue[field] !== "string" || issue[field].trim() === "")
            malformed(`issues[${index}].${field}`);
    }
    if (issue.suggestion !== undefined && typeof issue.suggestion !== "string")
        malformed(`issues[${index}].suggestion`);
    return {
        path: issue.path,
        code: issue.code,
        message: issue.message,
        ...(typeof issue.suggestion === "string" ? { suggestion: issue.suggestion } : {}),
    };
}
function canonicalJson(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    const record = value;
    const entries = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
}
export async function submitPlan(args, client) {
    validatePromptPayload(args.request);
    if (typeof args.plan !== "object" || args.plan === null || Array.isArray(args.plan)) {
        throw new TripdremoError("invalid_request", "plan must be a JSON object", { details: { field: "plan" } });
    }
    if (!loadConfig().devUser && !getToken())
        await startLogin(client, false);
    const payload = {
        schema_version: args.schema_version,
        request: args.request,
        plan: args.plan,
    };
    const payloadHash = createHash("sha256").update(canonicalJson(payload)).digest("hex");
    const identityHash = currentSubmissionIdentityHash();
    const pending = readPendingSubmission(identityHash);
    if (pending && pending.payload_hash !== payloadHash) {
        throw new TripdremoError("invalid_request", "A previous Tripdremo plan submission has an unknown outcome. Retry the same plan before submitting different content.", {
            retryable: true,
            details: { reason: "ambiguous_submission_pending", pending_since: pending.created_at },
        });
    }
    const submissionId = pending?.submission_id ?? randomUUID();
    if (!pending) {
        writePendingSubmission({
            submission_id: submissionId,
            payload_hash: payloadHash,
            identity_hash: identityHash,
            created_at: new Date().toISOString(),
        });
    }
    let response;
    try {
        response = await client.requestPlanSubmission({ submission_id: submissionId, ...payload });
    }
    catch (error) {
        const ambiguous = error instanceof TripdremoError && (error.code === "backend_unreachable"
            || (error.code === "invalid_request" && error.details.code === "submission_in_progress"));
        if (error instanceof TripdremoError && !ambiguous) {
            deletePendingSubmission();
        }
        throw error;
    }
    const raw = parseJsonSafely(response.body);
    if (response.status === 422) {
        if (raw.status !== "needs_revision")
            malformed("status");
        if (raw.schema_version !== "trip-plan.v3")
            malformed("schema_version");
        if (!Array.isArray(raw.issues) || raw.issues.length === 0)
            malformed("issues");
        if (typeof raw.plan !== "object" || raw.plan === null || Array.isArray(raw.plan))
            malformed("plan");
        const result = {
            status: "needs_revision",
            schema_version: raw.schema_version,
            issues: raw.issues.map(revisionIssue),
            plan: redactSensitive(raw.plan),
        };
        deletePendingSubmission();
        return result;
    }
    if (raw.status !== "ready")
        malformed("status");
    const ownerKind = currentOwnerKind();
    const shareHash = typeof raw.share_hash === "string" ? raw.share_hash : malformed("share_hash");
    const plan = projectPlan({ ...raw, share_url: resolveShareUrl(`/plans/${encodeURIComponent(shareHash)}`) }, false, ownerKind);
    if (response.status !== 201)
        malformed("http_status");
    deletePendingSubmission();
    if (ownerKind === "guest")
        appendPlan({ share_hash: shareHash, title: plan.title || "Plan" });
    return { status: "ready", plan };
}
//# sourceMappingURL=submit_plan.js.map