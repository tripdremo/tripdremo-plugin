---
name: tripdremo-connect
description: Plan with the AI in this conversation and save a shareable Tripdremo itinerary through the hosted connector. Use for Tripdremo connected-account planning, submission recovery, and account plan retrieval in ChatGPT, Claude, Codex, or Claude Code.
---

# Tripdremo Connect

Use the hosted Tripdremo MCP tools. The AI in the current conversation authors the itinerary; Tripdremo validates, enriches and saves it.

## Establish a ready connection

1. Discover the remote tools, call `tripdremo_auth_status` and fetch `tripdremo_get_plan_schema`. The connection is ready when both calls succeed and authentication confirms the intended account; keep the live schema for planning.
2. If the tools are missing or authorization is required, complete the host's connector setup and browser OAuth sign-in. Read [references/connection.md](references/connection.md) for host setup and fallback commands. A copied setup prompt requests this setup sequence; it does not prove installation or authentication succeeded.
3. Resume the original trip request only after the tools are available and both verification calls succeed. If the host cannot connect, report that exact limitation and the next setup action. An unsaved draft does not complete a request for a Tripdremo itinerary link.

Use browser sign-in for passwords and consent. Never request a password, one-time password, OAuth token or CLI credential in chat. Hosted access is account-only; local guest login and logout tools belong to the separate `tripdremo` profile.

## Plan and save

1. Use the current request and chat. Access private sources only when the user selected them. Preserve the full request as `request.prompt`; ask a short clarification only if the destination is absent.
2. Resolve ISO dates and travellers. Durations are inclusive: five days starting July 4 end July 8. A month without a year means its next occurrence; state chosen date assumptions. Keep the date difference at 45 days or fewer. Defaults are two adults, no children, balanced pace and comfortable budget; preserve explicit preferences.
3. Use the live schema from `tripdremo_get_plan_schema`; fetch it now if it was not already returned during this connection check. Author the complete Trip Plan v3 JSON with the AI in this conversation, using that live schema. Retain the full request and authored plan until the operation resolves. Use empty or public absolute HTTPS source and place-map URLs.
4. Explain that saving creates a shareable Tripdremo link. A request to save or create a Tripdremo link, including that request in the copied setup prompt, already authorizes submission. State the sharing effect and proceed without asking again; confirm only when saving or a Tripdremo link was not requested.
5. Call `tripdremo_prepare_submission` with `{request}`. Keep its `submission_id`, timestamps and the exact payload together in the current working context.
6. Call `tripdremo_submit_plan` with the returned UUID, `schema_version: "trip-plan.v3"`, the same request and authored plan.
7. On `ready`, present the returned title, dates, compact day summaries and real `plan.share_url`. A tool accepting the request is not evidence that the itinerary was saved.

## Resolve revisions and unknown outcomes

A `submission_id` belongs to one exact payload. Reuse it only for unchanged request and plan JSON.

- `needs_revision`: repair the returned plan using structured issue paths and codes. If status recovery omits the plan, repair the retained authored plan. Prepare a new UUID for that revised payload, then submit. Stop after two repair-and-resubmit attempts and show the remaining issues.
- Timeout, retryable backend failure, disconnect or unknown result: call `tripdremo_submission_status` with the UUID. If it was lost, omit the argument to list the ten most recent account operations and identify the original request from its dates and summary. Resolve that operation before preparing another UUID.
- `prepared` or `unknown`: retry the exact retained payload with the same UUID while it is unexpired. Never reconstruct changed content for the old UUID. If the payload is unavailable, report the recoverable operation and stop the write.
- `processing`: perform bounded status checks, then return the UUID and pending state if work remains. Do not claim completion or create another operation.
- Recovered `ready`: use the returned result and share URL. Recovered `needs_revision`: apply the revision branch.
- `submission_expired`: check status for a terminal result first. Start a new prepared operation only after the expired operation is confirmed inactive and has no saved result.
- `idempotency_conflict` or `prepared_request_conflict`: keep the existing UUID and recover its status; do not bypass the conflict with a fresh UUID.

Keep ordinary network recovery bounded to three checks/retries per user turn. A pending operation can be resumed in a later turn. Do not invoke cloud itinerary generation from this workflow.

## Read existing plans

- `whoami` or connection checks: `tripdremo_auth_status`.
- `plans`: `tripdremo_list_plans`; follow returned `next_page` only as needed.
- `open <share_hash>`: `tripdremo_get_plan`, with `include_payload: false` unless the user asks for full JSON.
- Recovery requests: `tripdremo_submission_status` with the saved UUID, or list recent operations.

Treat every other nonempty argument as a planning request. For empty arguments, ask for the trip destination and dates. Use only titles, UUIDs, hashes and URLs returned by the tools.
