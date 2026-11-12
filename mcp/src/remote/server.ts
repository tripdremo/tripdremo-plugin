import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isTripdremoError, TripdremoError } from "../errors.js";
import { parseJsonSafely } from "../tools/helpers.js";
import { projectPlan } from "../format/summary.js";
import { planRequestSchema } from "../tools/request-schema.js";
import { validatePromptPayload } from "../tools/validate.js";
import { VERSION } from "../version.js";
import type { RemoteBackend } from "./backend.js";

export const REMOTE_INSTRUCTIONS = `Use Tripdremo with the AI model in this conversation. A connection request or copied setup prompt requires native connector setup in this same host, browser OAuth sign-in, and successful tripdremo_auth_status and tripdremo_get_plan_schema calls before planning. If a setup step cannot be completed here, preserve the original request and name the exact native action still needed; a generic travel draft does not complete a connection request.
Use the live schema to author the complete Trip Plan v3 JSON in this conversation. Retain the original structured request and authored plan until the operation resolves. Saving stores the itinerary and creates a shareable link. An explicit request to save or return a Tripdremo link, including the copied setup prompt's save request, already authorizes submission: disclose sharing and proceed without asking again. Obtain authorization only if saving was not requested.
Call tripdremo_prepare_submission with {request}. Keep its returned submission_id, then call tripdremo_submit_plan with {submission_id, schema_version: "trip-plan.v3", request, plan}. A submission_id identifies exactly one payload: retry unchanged content with the same ID. After a structured needs_revision result, repair the returned plan (or the retained plan if recovery omits it) using its issues, call tripdremo_prepare_submission again, and submit the revised payload with the new ID. Allow at most two repair attempts.
On timeout or unknown outcome, call tripdremo_submission_status with {submission_id} before preparing another operation; omit the ID to list recent operations if it was lost. Recover or retry an unexpired operation with its exact retained payload and original ID. Poll processing outcomes with bounded checks; return the pending ID if unresolved. Only report a saved itinerary when the backend returns ready and a real plan.share_url.
Use tripdremo_get_plan and tripdremo_list_plans for account retrieval. Browser OAuth manages connection; local guest/login/logout tools and backend AI are unavailable in this hosted workflow. Never request passwords or tokens in chat.`;

const empty = z.object({}).strict();
const prepare = z.object({ request: planRequestSchema }).strict();
const submit = z.object({
  submission_id: z.uuid().describe("UUID returned by tripdremo_prepare_submission. Reuse only for an identical request and plan."),
  schema_version: z.literal("trip-plan.v3"),
  request: planRequestSchema,
  plan: z.record(z.string(), z.json()),
}).strict();
const status = z.object({ submission_id: z.uuid().optional().describe("Recover this operation. Omit to list the 10 most recent account submissions after reconnecting.") }).strict();
const get = z.object({
  share_hash: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128),
  include_payload: z.boolean().default(false),
}).strict();
const list = z.object({ limit: z.number().int().min(1).max(100).default(20), page: z.number().int().min(1).default(1) }).strict();

function definition(name: string, description: string, schema: z.ZodType, readOnly: boolean, idempotent = true): Tool {
  return { name: `tripdremo_${name}`, description, inputSchema: z.toJSONSchema(schema) as Tool["inputSchema"], annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: idempotent, openWorldHint: true } };
}

const tools = [
  definition("auth_status", "Verify the connected Tripdremo account before planning or saving.", empty, true),
  definition("get_plan_schema", "Fetch the current Trip Plan v3 JSON schema; the current conversation AI authors the plan.", empty, true),
  definition("prepare_submission", "Reserve a durable submission UUID for the original structured request. Recover unknown operations before reserving another ID.", prepare, false, false),
  definition("submit_plan", "Validate, enrich and save an AI-authored plan. Replays require the same submission_id and identical payload. Structured needs_revision results require a new prepared ID after repair.", submit, false),
  definition("submission_status", "Recover an operation by UUID or list recent account submissions. Resolve unknown outcomes before creating another operation.", status, true),
  definition("get_plan", "Read a plan available to the connected account by share hash.", get, true),
  definition("list_plans", "List connected-account plans with page and limit pagination.", list, true),
];

function result(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function compactPlan(raw: Record<string, unknown>, includePayload = false) {
  const trip = raw.trip ? parseJsonSafely<Record<string, unknown>>(raw.trip) : raw;
  if (typeof trip.share_hash !== "string" || !/^[A-Za-z0-9_-]+$/.test(trip.share_hash)) {
    throw new TripdremoError("internal", "Tripdremo returned a malformed share hash.");
  }
  return projectPlan({ ...trip, share_url: `https://tripdremo.com/en/plans/${trip.share_hash}` }, includePayload, "user");
}

function submissionResult(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.status !== "ready") return raw;
  return { status: "ready", ...(typeof raw.submission_id === "string" ? { submission_id: raw.submission_id } : {}), plan: compactPlan(raw) };
}

function operationResult(raw: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(raw.operations)) return { ...raw, operations: raw.operations.map((entry) => operationResult(parseJsonSafely(entry))) };
  if (raw.result && typeof raw.result === "object" && !Array.isArray(raw.result)) {
    return { ...raw, result: submissionResult(raw.result as Record<string, unknown>) };
  }
  return raw;
}

export function createRemoteServer(backend: RemoteBackend): Server {
  const server = new Server({ name: "tripdremo-connect", version: VERSION }, { capabilities: { tools: {} }, instructions: REMOTE_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const args = params.arguments ?? {};
      let value: Record<string, unknown>;
      switch (params.name) {
        case "tripdremo_auth_status":
          empty.parse(args); value = await backend.request("GET", "/mcp/auth-status/"); break;
        case "tripdremo_get_plan_schema":
          empty.parse(args); value = await backend.request("GET", "/mcp/schema/"); break;
        case "tripdremo_prepare_submission": {
          const parsed = prepare.parse(args); validatePromptPayload(parsed.request);
          value = await backend.request("POST", "/mcp/submissions/prepare/", parsed); break;
        }
        case "tripdremo_submit_plan": {
          const parsed = submit.parse(args); validatePromptPayload(parsed.request);
          value = submissionResult(await backend.request("POST", "/mcp/submissions/", parsed)); break;
        }
        case "tripdremo_submission_status": {
          const parsed = status.parse(args);
          value = operationResult(await backend.request("GET", parsed.submission_id ? `/mcp/submissions/${parsed.submission_id}/` : "/mcp/submissions/?limit=10")); break;
        }
        case "tripdremo_get_plan": {
          const parsed = get.parse(args);
          value = { plan: compactPlan(await backend.request("GET", `/mcp/plans/${parsed.share_hash}/`), parsed.include_payload) };
          break;
        }
        case "tripdremo_list_plans": {
          const parsed = list.parse(args);
          const page = await backend.request("GET", `/mcp/plans/?limit=${parsed.limit}&page=${parsed.page}`);
          if (!Array.isArray(page.results)) throw new TripdremoError("internal", "Tripdremo returned a malformed plan list.");
          value = { count: page.count, page: parsed.page, next_page: page.next ? parsed.page + 1 : null, previous_page: page.previous ? parsed.page - 1 : null, results: page.results.map((trip) => compactPlan(parseJsonSafely(trip))) }; break;
        }
        default: throw new TripdremoError("invalid_request", `Unknown tool: ${params.name}`);
      }
      return result(value);
    } catch (error) {
      const normalized = isTripdremoError(error) ? error : error instanceof z.ZodError
        ? new TripdremoError("invalid_request", "Tool input did not match the advertised schema.", { details: { issues: error.issues } })
        : new TripdremoError("internal", "The Tripdremo tool failed unexpectedly.");
      return { ...result(normalized.toJson()), isError: true };
    }
  });
  return server;
}
