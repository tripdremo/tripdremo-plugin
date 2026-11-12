import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isTripdremoError, TripdremoError } from "./errors.js";
import { authStatus } from "./tools/auth_status.js";
import { createPlan } from "./tools/create_plan.js";
import { getPlan } from "./tools/get_plan.js";
import { getPlanSchema as fetchPlanSchema } from "./tools/get_plan_schema.js";
import { listPlans } from "./tools/list_plans.js";
import { loginStart } from "./tools/login_start.js";
import { loginWait } from "./tools/login_wait.js";
import { logout } from "./tools/logout.js";
import { planStatus } from "./tools/plan_status.js";
import { savePlanToAccount } from "./tools/save_plan.js";
import { submitPlan } from "./tools/submit_plan.js";
const emptyArgs = z.object({}).strict();
const loginStartSchema = z.object({
    open_browser: z.boolean().default(true).describe("Open the Tripdremo verification page in the default browser."),
}).strict();
const loginWaitSchema = z.object({
    timeout_seconds: z.number().int().min(0).max(120).default(120)
        .describe("Maximum seconds to wait for browser approval before returning the current status."),
}).strict();
const childSchema = z.object({
    age: z.number().int().min(0).max(17).describe("Child age in whole years, from 0 through 17."),
}).strict();
const planRequestFields = {
    prompt: z.string().min(1).max(4_000).describe("Natural-language trip request and priorities."),
    origin: z.string().max(255).default("").describe("Optional trip origin, up to 255 characters; an empty string lets Tripdremo infer it."),
    destination: z.string().max(255).default("").describe("Optional destination, up to 255 characters; an empty string lets Tripdremo infer it from the prompt."),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Trip start date in YYYY-MM-DD format."),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Trip end date in YYYY-MM-DD format; must not precede start_date."),
    adults: z.number().int().min(1).max(12).default(2).describe("Number of adult travellers, from 1 through 12."),
    children: z.array(childSchema).max(12).default([]).describe("Up to 12 child travellers, each represented by an age in whole years."),
    style: z.enum(["relaxed", "balanced", "active", "camper", "luxury"]).default("balanced")
        .describe("Preferred itinerary pace and travel style."),
    budget: z.enum(["value", "comfortable", "premium"]).default("comfortable")
        .describe("Preferred trip budget tier."),
    constraints: z.record(z.string(), z.unknown()).default({})
        .describe("Free-form JSON object containing dietary, mobility, transport, or other trip constraints."),
};
const planRequestSchema = z.object(planRequestFields).strict();
const createPlanSchema = z.object({
    ...planRequestFields,
    wait_seconds: z.number().int().min(0).max(120).default(0)
        .describe("Seconds to wait for gated Tripdremo backend-AI generation before returning a polling handle; 0 returns immediately."),
}).strict();
const submitPlanSchema = z.object({
    schema_version: z.literal("trip-plan.v3")
        .describe("Exact live Tripdremo plan schema version used to author the submitted plan."),
    request: planRequestSchema
        .describe("Original trip request. wait_seconds is forbidden because submission performs no AI generation."),
    plan: z.record(z.string(), z.json())
        .describe("Complete Trip Plan v3 JSON object authored by the host model from tripdremo_get_plan_schema."),
}).strict();
const planStatusSchema = z.object({
    job_id: z.number().int().positive().describe("Positive generation job identifier returned by tripdremo_create_plan."),
}).strict();
const getPlanSchema = z.object({
    share_hash: z.string().min(1).describe("Public Tripdremo share hash identifying the plan."),
    include_payload: z.boolean().default(false).describe("Include the full trip payload when true; defaults to the compact plan summary."),
}).strict();
const listPlansSchema = z.object({
    limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of plans to return from each source, from 1 through 100."),
}).strict();
const savePlanSchema = z.object({
    share_hash: z.string().min(1).describe("Public share hash of the guest plan to save to the authenticated account."),
}).strict();
function toolResult(value) {
    const structuredContent = value !== null && typeof value === "object"
        ? value
        : { value };
    return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent };
}
function toolError(error) {
    const normalized = isTripdremoError(error)
        ? error
        : error instanceof z.ZodError
            ? new TripdremoError("invalid_request", "Tool input did not match the advertised schema.", { details: { issues: error.issues } })
            : new TripdremoError("internal", "The Tripdremo tool failed unexpectedly.", { cause: error });
    const payload = normalized.toJson();
    return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
    };
}
async function runTool(schema, args, operation) {
    try {
        return toolResult(await operation(schema.parse(args)));
    }
    catch (error) {
        return toolError(error);
    }
}
function inputSchema(schema) {
    return z.toJSONSchema(schema);
}
const tools = [
    { name: "tripdremo_auth_status", description: "Return the current local Tripdremo authentication state and API target.", inputSchema: inputSchema(emptyArgs), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "tripdremo_login_start", description: "Start the Tripdremo browser device-code login flow.", inputSchema: inputSchema(loginStartSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    { name: "tripdremo_login_wait", description: "Wait for approval of the active Tripdremo browser login flow.", inputSchema: inputSchema(loginWaitSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    { name: "tripdremo_logout", description: "Clear the local Tripdremo credential and attempt to revoke it.", inputSchema: inputSchema(emptyArgs), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } },
    { name: "tripdremo_get_plan_schema", description: "Fetch the live Trip Plan v3 JSON Schema anonymously. Use this first, author the full itinerary with the host model, then call tripdremo_submit_plan for the default zero-backend-LLM route.", inputSchema: inputSchema(emptyArgs), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    { name: "tripdremo_submit_plan", description: "Validate, enrich, and store a host-model-authored Trip Plan v3 without Tripdremo backend AI. A needs_revision result contains structured issues for local repair and resubmission.", inputSchema: inputSchema(submitPlanSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    { name: "tripdremo_create_plan", description: "Explicitly invoke gated Tripdremo backend AI to generate an itinerary. This expensive cloud fallback is disabled unless the Tripdremo backend enables it.", inputSchema: inputSchema(createPlanSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    { name: "tripdremo_plan_status", description: "Read the current progress or terminal result of a generation job.", inputSchema: inputSchema(planStatusSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    { name: "tripdremo_get_plan", description: "Read a ready plan through its public Tripdremo share hash.", inputSchema: inputSchema(getPlanSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    { name: "tripdremo_list_plans", description: "List locally remembered guest plans and available account plans.", inputSchema: inputSchema(listPlansSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    { name: "tripdremo_save_plan_to_account", description: "Save a public guest plan into the currently authenticated Tripdremo account.", inputSchema: inputSchema(savePlanSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
];
export function createTripdremoServer(client) {
    const server = new Server({ name: "tripdremo", version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const args = request.params.arguments ?? {};
        switch (request.params.name) {
            case "tripdremo_auth_status":
                return runTool(emptyArgs, args, () => authStatus());
            case "tripdremo_login_start":
                return runTool(loginStartSchema, args, (parsed) => loginStart(parsed, client));
            case "tripdremo_login_wait":
                return runTool(loginWaitSchema, args, (parsed) => loginWait(parsed, client));
            case "tripdremo_logout":
                return runTool(emptyArgs, args, () => logout({}, client));
            case "tripdremo_create_plan":
                return runTool(createPlanSchema, args, (parsed) => createPlan(parsed, client));
            case "tripdremo_get_plan_schema":
                return runTool(emptyArgs, args, () => fetchPlanSchema(client));
            case "tripdremo_submit_plan":
                return runTool(submitPlanSchema, args, (parsed) => submitPlan(parsed, client));
            case "tripdremo_plan_status":
                return runTool(planStatusSchema, args, (parsed) => planStatus(parsed, client));
            case "tripdremo_get_plan":
                return runTool(getPlanSchema, args, (parsed) => getPlan(parsed, client));
            case "tripdremo_list_plans":
                return runTool(listPlansSchema, args, (parsed) => listPlans(parsed, client));
            case "tripdremo_save_plan_to_account":
                return runTool(savePlanSchema, args, (parsed) => savePlanToAccount(parsed, client));
            default:
                return toolError(new TripdremoError("invalid_request", `Unknown tool: ${request.params.name}`));
        }
    });
    return server;
}
//# sourceMappingURL=server.js.map