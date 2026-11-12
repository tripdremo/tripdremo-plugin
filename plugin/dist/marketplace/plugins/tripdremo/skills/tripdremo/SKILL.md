---
name: tripdremo
description: Plan a real trip locally with the current host model, enrich and save it through Tripdremo, get a shareable itinerary link, or sign in to a Tripdremo account. Use when the user asks to plan, generate, or save a trip or itinerary, asks for a Tripdremo link, or types /tripdremo.
---

# Tripdremo

Route intent to the Tripdremo MCP tools. Keep natural-language parsing in this skill; do not construct HTTP requests.

## Recognize setup intent

A request to connect the current AI, including a copied prompt pointing to `https://tripdremo.com/ai/connect.txt`, is a setup request. Follow that connection guide using the real host's native integration controls, preserve the original trip request, and verify `tripdremo_auth_status` and `tripdremo_get_plan_schema` before resuming it. If setup requires a user action, give the exact missing native step and wait; an ordinary travel draft does not complete setup. Select the save workflow from the tools actually available: hosted tools expose `tripdremo_prepare_submission`, while this local profile keeps the direct submission and guest behavior below.

The existing local `/tripdremo` command forms and arguments remain as follows.

## Route the request

Preserve the raw arguments and trim only their outer whitespace.

| Form | Action |
| --- | --- |
| Exact `login` | Call `tripdremo_login_start` with `open_browser: true`, then `tripdremo_login_wait` with a bounded timeout. |
| Exact `logout` | Call `tripdremo_logout` for the active local session if present. |
| Exact `whoami` | Call `tripdremo_auth_status`. |
| Exact `plans` | Call `tripdremo_list_plans` with the default limit. |
| First token `open` | Require one share hash, call `tripdremo_get_plan`, and print the returned absolute share link. Default `include_payload` to `false`; set it to `true` only when the remaining natural language explicitly requests the full payload. |
| First token `help` | Print the six public command forms and stop without calling a tool. |

Treat every other argument string as a planning request and preserve the entire string verbatim as `prompt`. This includes `plan ...`, `create ...`, `get ...`, `list`, `status`, and `save ...`. If the arguments are empty, show the same output as `help`.

## Create a plan

Read [references/request-building.md](references/request-building.md) before building arguments.

1. Use the current request, the current chat, and only the private sources the user explicitly selects. If connected personal data could materially improve the plan, name the source and ask before accessing it. Do not search past chats, memory, email, calendar, files, or other connectors by default.
2. Ask at most one question, and only when the destination is genuinely absent.
3. Resolve dates, travelers, style, and budget; state only date assumptions.
4. Call `tripdremo_get_plan_schema` and use the returned current Trip Plan v3 JSON Schema as the only plan-shape authority.
5. Author the complete Trip Plan v3 JSON with the current host model. Perform all destination selection, itinerary reasoning, day design, pacing, and travel trade-offs locally in the host model. Keep every source and place map URL empty or absolute HTTPS on a public host.
6. Before `tripdremo_submit_plan`, explain that submission saves the itinerary to Tripdremo and creates a shareable link. An explicit request to save the plan or create a Tripdremo link, including that request in the copied setup prompt, already authorizes submission; state the sharing effect and proceed without asking again. Otherwise ask for confirmation and wait.
7. Call `tripdremo_submit_plan` with the original structured request and the authored plan. On the first request, this tool silently provisions the server-authenticated guest CLI identity; do not start browser login first.
8. If the result is `needs_revision`, repair the returned plan locally using only its structured `issues`, then resubmit. Make at most two repair-and-resubmit attempts.
9. If the result is `ready`, render the compact plan and share URL. If issues remain after two repairs, stop and report the remaining structured issues without claiming that a plan was saved.

If submission has a retryable ambiguous outcome or returns provider code `enrichment_unavailable`, keep the request and plan content unchanged and retry the same tool arguments. Do not count an unchanged recovery retry as a revision attempt. The MCP server keeps only hardened `0600` hashes and the hidden UUID for up to 24 hours so the retry reuses the same logical submission identity. Do not submit different content until the pending outcome resolves or expires.

Tripdremo performs deterministic schema validation, maps and route calculations, image enrichment, and persistence. It does not perform itinerary reasoning in this flow. Never call `tripdremo_create_plan`, `tripdremo_plan_status`, or silently fall back to backend AI from this skill. Backend-AI generation is a separate, explicit `$tripdremo-cloud` skill.

Do not use `tripdremo_get_plan` to create or regenerate a plan. `open` retrieves an existing public plan by share hash and does not spend a plan submission.

## Retrieve and render a plan

Read [references/output.md](references/output.md) before rendering a plan.

- Keep creation and normal `open` retrieval compact.
- Request `trip_payload` only when the user explicitly asks for the full payload in natural language.
- Never infer or invent a title, day, URL, job ID, or share hash.

## Respect identity boundaries

Read [references/auth.md](references/auth.md) before any login, logout, guest-ownership, or account claim action.

Use the MCP login/session tools for this flow and never request a password, one-time password, Supabase token, or Tripdremo CLI token. Treat backend account listing, saving, editing, and commenting as account-only; a guest may create its one successful lifetime plan, read public shares, and see only locally recorded guest-plan references through the CLI.

A copied setup prompt directs the assistant through native installation, browser sign-in and verification; it is not evidence those steps succeeded. A normal local planning request can still use the existing guest submission flow. Keep that distinction when reporting connection and save results.

## Handle failures

Read [references/troubleshooting.md](references/troubleshooting.md), branch only on `error.code`, print the exact sentence, and perform the stated next action. Never branch on free-text error messages.
