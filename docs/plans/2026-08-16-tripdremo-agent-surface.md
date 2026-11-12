# Tripdremo agent surface implementation plan

Date: 2026-08-16

## Outcome and boundaries

Build one contract-first repository containing a TypeScript stdio MCP server, two Tripdremo skills, and a bundled Codex + Claude Code plugin. The default skill makes the host model author the complete Trip Plan v3 itinerary from Tripdremo's online schema; Tripdremo performs deterministic validation, images, maps, calculations, and persistence. A second explicit skill preserves the more expensive backend-AI generator. The terminal deliverable is a real compact itinerary and an absolute locale-prefixed Tripdremo share URL. Section 10 was approved on 2026-08-16 with one server-authenticated guest plan per persistent device.

Locked constraints:

- Node.js 20+, TypeScript, ESM, official `@modelcontextprotocol/sdk`, stdio only.
- MCP owns structured tools and HTTP; the default skill and host model own natural-language interpretation and itinerary reasoning; the plugin owns packaging only.
- JSON Schemas land before producers and consumers, and consumers branch only on `error.code`.
- Preserve the nine original v1 tools and add only the schema-fetch and host-authored-plan submission tools required for local-first planning; no editing, adjustment, comments, packing, budget, YAML import, telemetry, or remote MCP transport.
- No password, OTP, Supabase token, or raw Tripdremo CLI token may enter a tool schema, log, or result.
- Never call backend AI from the default skill or fall back between modes automatically.
- Gate only the explicit plugin cloud route `/trips/agent-generate/` with `TRIPDREMO_AGENT_BACKEND_AI_ENABLED=0`; leave the normal website `/trips/generate/` route unchanged.
- Keep normal MCP requests on `TRIPDREMO_TIMEOUT_MS=30000`; use the separate `TRIPDREMO_SUBMIT_TIMEOUT_MS=300000` only for deterministic host-authored plan submission because maps, geocoding, route calculations, and image enrichment may take longer.
- Keep `policy.allow_implicit_invocation: false` in the canonical cloud skill's Codex metadata. Inject Claude-only `disable-model-invocation: true` into the generated Claude marketplace/install skill during plugin packaging, because canonical Codex skill validation rejects that Claude frontmatter field.
- Keep `submission_id` private to the MCP/backend envelope: generate one UUID v4 for a logical submission, persist only its hardened hashes and timestamp with mode `0600`, and reuse it for the exact same payload for up to 24 hours after ambiguity. Issue exactly one POST per tool invocation with no automatic retry after 429, 5xx, timeout, or ambiguous network failure.
- Reject host-authored submissions above 1,000,000 bytes or 240 combined locations before enrichment. Return structured `needs_revision` issues without persistence; only a READY stored Trip consumes successful-plan quota.
- Require empty or absolute public HTTPS source/map URLs and at most 12 children. Reject raw schema, location-cap, and unsafe-URL mistakes before durable receipts or enrichment budgets, while still applying the 120-request/hour identity throttle.
- Fence backend processing with a renewable 900-second lease, retain completed receipts for 30 days, and keep the 50-plan account success quota separate from 100 durable accepted enrichment starts per account per UTC day.
- Return provider outages as retryable `enrichment_unavailable`; preserve the pending UUID so an unchanged later retry can recover the same logical submission.

## Section 14 decisions

| Question | Current decision |
| --- | --- |
| Section 10 approval | **Approved by the user on 2026-08-16.** Implement the production guest-to-account flow in `trips-2026`. |
| Guest quota | **1 successful plan per persistent device across agent modes.** A failure before a `Trip` exists releases the device allowance; the accepted-start network budget remains consumed. Every agent submission remains authenticated by the opaque CLI session token. |
| Authenticated local-first quota | **Generous and separate, configurable with a default of 50 successful stored plans.** Host-authored submissions must not consume the smaller backend-AI quota. |
| Backend-AI quota and gate | **Preserve the existing smaller quota.** Expose it only through explicit `tripdremo-cloud` use and `/trips/agent-generate/`, disabled by default with `TRIPDREMO_AGENT_BACKEND_AI_ENABLED=0`. Do not change the website `/trips/generate/` route. |
| Weak/old model routing | **Future explicit capability decision.** Do not infer model quality or silently switch modes in this implementation. |
| Distribution | Bundle the built server inside the plugin unless overridden. This makes the plugin deterministic and avoids an npm publication prerequisite. |
| Host scope | Codex + Claude Code unless overridden. |
| Brand assets | Use the canonical Tripdremo wordmark PNG for the plugin logo. Keep the composer icon square and brand-derived because the official wordmark is horizontal; do not treat PNG as unsupported. |

## Contract clarifications

- `tripdremo-plan-result.v1.schema.json` defines the compact bare plan; tool envelopes wrap it.
- Healthy `pending`, `expired`, and `generating` workflow states remain status envelopes. Matching error codes are reserved for terminal/stale/error responses so every code remains reachable without turning normal polling into failure.
- A bounded `create_plan` wait returns a generating job handle when time expires; the skill emits `generation_timeout` only after its overall five-minute polling budget.
- The live serializer accepts child ages `0..17` and rejects a date difference greater than 45 days; tests match that implementation and document the inclusive-calendar ambiguity.
- Five calendar days use an end date four days after the start. README examples must not label 4–9 July as five days.
- Claude Code marketplace skills are necessarily namespaced; the installed command is `/tripdremo:tripdremo`, while Codex exposes `/tripdremo`.

## Phase 0 — Ground and decide

### Step 0.1 — Confirm the shape

- [x] Task: Re-verify every API fact in §1 against `trips-2026` and note drift with exact file evidence — model: sonnet 4.6
- [x] Task: Verify the Next `/api/v1` proxy, public shared-plan route, locale list, path-only `share_url`, and frontend Supabase email/password flow — model: sonnet 4.6
- [x] Task: Answer §14 questions with the user and record the final guest/login branch — model: opus 4.8
- [x] Task: Record the approved Section 10 quota, authentication requirement, and abuse boundary — model: opus 4.8
- [x] Task: Write this Phase → Step → Task plan before implementation — model: fable 5
- [x] Task: Land the four v1 JSON Schemas in `contracts/` before code consumers — model: fable 5

### Step 0.2 — Define evidence

- [x] Task: Map each §12 acceptance criterion to a command, fixture, or live observation — model: sonnet 4.6
- [x] Task: Define exact nine-tool inventory and JSON-RPC-only stdout assertions — model: haiku 4.5
- [x] Task: Define token-leak checks for source, fixtures, logs, stdout, stderr, tool results, and build output — model: sonnet 4.6
- [x] Task: Record honest stop conditions for incomplete cross-repository and interactive-host verification — model: opus 4.8

## Phase 1 — MCP server core

### Step 1.1 — Skeleton

- [x] Task: Create the npm workspace, Node engine contract, shared TypeScript config, build/typecheck scripts, and `node:test` harness — model: haiku 4.5
- [x] Task: Rename the empty `skil/` directory to `skills/` without a compatibility alias — model: haiku 4.5
- [x] Task: Create the ESM package and shebang bin launcher with no business logic in the launcher — model: haiku 4.5
- [x] Task: Implement `config.ts` as the single source for env defaults, URL normalization, locale, timeout, log level, and localhost dev-user guard — model: sonnet 4.6
- [x] Task: Implement the closed error enum, schema-conforming envelopes, retryability, safe details, and internal incident ids — model: sonnet 4.6
- [x] Task: Compile all four schemas and validate representative requests/results/auth states/errors in tests — model: sonnet 4.6

### Step 1.2 — API layer

- [x] Task: Implement one injectable typed fetch wrapper with timeout, required User-Agent, explicit anonymous reads, bearer/dev auth, and JSON decoding — model: sonnet 4.6
- [x] Task: Retry only explicit HTTP 429 and 5xx responses, with three total attempts, exponential backoff, jitter, bounded `Retry-After`, and no ambiguous write retries — model: sonnet 4.6
- [x] Task: Map validation, auth, quota, not-found, rate-limit, generation-502, network, and generic server failures to the closed error set — model: sonnet 4.6
- [x] Task: Prove non-retryable 4xx and ambiguous network failures execute once and retryable HTTP responses never exceed three attempts — model: sonnet 4.6
- [x] Task: Build absolute share URLs for `en`, `lt`, `de`, and `pl`, including localhost and encoded hashes — model: haiku 4.5

### Step 1.3 — Planning tools

- [x] Task: Validate prompt, dates, adults, children, enums, constraints, wait budget, and unknown fields before HTTP — model: sonnet 4.6
- [x] Task: Implement `tripdremo_create_plan` for synchronous 201, asynchronous 202, bounded wait polling, and draft rejection — model: opus 4.8
- [x] Task: Implement `tripdremo_plan_status` from nested `generation_job` progress and terminal trip/error states — model: opus 4.8
- [x] Task: Implement anonymous `tripdremo_get_plan` through the public share endpoint with opt-in payload only — model: sonnet 4.6
- [x] Task: Implement `tripdremo_list_plans` with fixed-page account pagination, exact limits, and local guest refs — model: sonnet 4.6
- [x] Task: Project `trip_payload.data.days` to `{index,title,stop_count,drive_summary}` without terminal prose — model: sonnet 4.6
- [x] Task: Validate representative successful compact plans against the plan-result contract and reject malformed live payloads — model: sonnet 4.6

### Step 1.4 — Transport

- [x] Task: Advertise exactly nine tools with descriptions on every input field, safe annotations, and no credential-shaped inputs — model: sonnet 4.6
- [x] Task: Keep `index.ts` to stdio wiring and send all diagnostics to stderr — model: haiku 4.5
- [x] Task: Add an SDK client smoke test for initialize, listTools, invalid calls, exact names, and clean stdio — model: sonnet 4.6
- [x] Task: Convert handler exceptions and manual Zod validation failures into schema-conforming structured tool errors — model: sonnet 4.6

## Phase 2 — Auth

**Approved on 2026-08-16:** every generation request uses a server-authenticated CLI or account identity. A first planning request auto-provisions an opaque guest credential; the persistent device has one successful lifetime guest plan.

### Step 2.1 — Local identity

- [x] Task: Implement atomic `auth/store.ts` writes, persistent UUIDv4 device id, directory `0700`, credentials `0600`, symlink/oversize guards, and corrupt-file tolerance — model: sonnet 4.6
- [x] Task: Implement non-secret bounded/deduplicated `plans.json` persistence without deleting it on logout — model: sonnet 4.6
- [x] Task: Implement `cli_…last4` diagnostic redaction and prove raw-token absence — model: sonnet 4.6
- [x] Task: Implement explicit localhost-only `TRIPDREMO_DEV_USER`; never use it as an auth fallback — model: haiku 4.5

### Step 2.2 — Device flow

- [x] Task: Implement guest provisioning with `cli_token`, `device_code`, `user_code`, expiry, and backend interval persisted without exposure — model: opus 4.8
- [x] Task: Implement `login_start`, best-effort browser opening, `login_wait`, pending/approved/expired states, and claimed-plan reconciliation — model: opus 4.8
- [x] Task: Implement side-effect-safe auth status and logout that clears active credentials, persists a dormant `0600` revocation tombstone on remote failure, and retries it before reprovisioning — model: opus 4.8
- [x] Task: Implement account-only save with strict auth and structured errors — model: sonnet 4.6
- [x] Task: Reject password, OTP, email-token, and Supabase-token-like unknown inputs at the tool-schema boundary — model: sonnet 4.6

## Phase 3 — Skill and plugin

### Step 3.1 — Skill

- [x] Task: Write `SKILL.md` with exact subcommand routing, planning fallback, one-question destination rule, waiting protocol, and one-time login offer — model: fable 5
- [x] Task: Write `request-building.md` for verbatim prompt preservation, concrete date assumptions, travellers, style, budget, and bounds — model: opus 4.8
- [x] Task: Write `auth.md` for none/guest/user states and browser-only credential entry — model: opus 4.8
- [x] Task: Write `output.md` for compact day rendering and the absolute link on its own line — model: opus 4.8
- [x] Task: Write `troubleshooting.md` with one exact sentence and next action per error code — model: opus 4.8
- [x] Task: Validate skill frontmatter and ensure commands contain no duplicated routing/HTTP logic — model: sonnet 4.6

### Step 3.2 — Plugin

- [x] Task: Create valid Codex and Claude manifests with only existing bundle paths — model: haiku 4.5
- [x] Task: Replace the invented main logo with the canonical Tripdremo wordmark and retain a separate square composer icon — model: haiku 4.5
- [x] Task: Bundle the complete built MCP server and runtime dependencies under `plugin/mcp/` — model: sonnet 4.6
- [x] Task: Generate Claude Markdown (`$ARGUMENTS`) and Codex TOML (`{{args}}`) commands from one source — model: sonnet 4.6
- [x] Task: Validate manifests, generated paths, non-symlink skill copy, executable bin, and bundle handshake in `build-plugin.mjs` — model: sonnet 4.6
- [x] Task: Install and verify in Codex with plugin listing, MCP connection, nine tools, and `/tripdremo whoami` evidence — model: sonnet 4.6
- [x] Task: Install and verify in Claude Code with plugin inventory, namespaced command recognition, and MCP auth-status evidence — model: sonnet 4.6

## Phase 4 — Backend (`trips-2026`)

### Step 4.1 — Server

- [x] Task: Add `CliSession` and migration with hashed raw token, device/code lifecycle, guest/user ownership, expiry, and revocation — model: sonnet 4.6
- [x] Task: Add `CliGuestGenerationBudget` and migration with a unique hashed-network/UTC-day counter — model: sonnet 4.6
- [x] Task: Add the persistent `guest_plan_used_at` success marker and fresh-principal inactive-device reprovisioning without old private ownership recovery — model: sonnet 4.6
- [x] Task: Add `AccountPlanGenerationReservation` and migration to serialize account generation, YAML import, shared-plan save, and CLI approval with a one-hour stale timeout — model: sonnet 4.6
- [x] Task: Add `CliTokenAuthentication` before Supabase auth, make Supabase decline `cli_` tokens, and preserve production demo-auth prohibition — model: opus 4.8
- [x] Task: Add the one-successful-plan lifetime device quota, hashed database-backed daily accepted-start budget, trusted-proxy-aware throttling, and registered-user quota isolation — model: opus 4.8
- [x] Task: Implement device/token/approve/revoke endpoints with transactional server-side trip and generation-job re-parenting, and approved-code replay only for active sessions — model: fable 5
- [x] Task: Add guest, quota, approval, double-approval, expiry, revocation, hashing, and production-config tests — model: sonnet 4.6

### Step 4.2 — Web

- [x] Task: Add the localized CLI authorize page using the existing Supabase email/password session and login UI — model: sonnet 4.6
- [x] Task: Add complete `en`, `lt`, `de`, and `pl` strings and approval-state tests — model: sonnet 4.6

### Step 4.3 — Wire up

- [x] Task: Demonstrate guest generation → browser login → unchanged CLI token → server-side re-parent → account listing — model: opus 4.8
- [x] Task: Demonstrate guest quota, database-backed network budget, trusted-proxy handling, registration throttle, revoked-token denial, and no raw token or IP persistence in focused backend tests — model: opus 4.8
- [x] Task: Demonstrate failed-before-Trip allowance release, inactive-device fresh-principal isolation, account reservation races/stale expiry, and active-only approval replay in focused backend tests — model: opus 4.8

## Phase 5 — Ship

### Step 5.1 — Documentation

- [x] Task: Write README install commands, env vars, bundled-server rationale, security/storage behavior, host command names, and development commands — model: sonnet 4.6
- [x] Task: Include corrected guest/login/subcommand transcripts and state the final production guest/login availability — model: sonnet 4.6
- [x] Task: Document known gaps rather than presenting localhost-only behavior as shipped — model: sonnet 4.6

### Step 5.2 — Acceptance evidence

- [x] Task: Run root `npm run build && npm test` — model: opus 4.8
- [x] Task: Prove the stdio handshake lists exactly nine tools with JSON-RPC-only stdout — model: opus 4.8
- [x] Task: Against local `trips-2026`, auto-provision a guest through real HTTP, create a READY deterministic plan in the test harness, and fetch it publicly by share hash — model: opus 4.8
- [x] Task: Resolve the absolute locale-prefixed share link in the running frontend — model: sonnet 4.6
- [ ] Task: Run error-code reachability, schema, permission, and token-leak suites — model: opus 4.8
- [x] Task: Capture Codex and Claude plugin verification, including Claude's mandatory plugin namespace — model: sonnet 4.6
- [x] Task: Run the 149-test combined backend suite, the frontend build, and six focused authorization-page E2E tests — model: opus 4.8
- [x] Task: Run the full Django planner suite with the exact historical YAML available only as a colocated test fixture — model: opus 4.8
- [x] Task: Run the full current-source MCP guest-to-account round trip across real HTTP and the Playwright browser approval page — model: opus 4.8
- [x] Task: Report every §12 item as met, unmet, or blocked with exact evidence — model: opus 4.8

### Historical §12 baseline before Phase 6

These results verify the original nine-tool backend-generation surface. They remain valid evidence for the unchanged authentication and security foundation, but they do not verify the expanded local-first tool inventory or two-skill plugin.

| Criterion | Status | Evidence / blocker |
| --- | --- | --- |
| 1. Root build and tests | Met | MCP passes 84/84, the focused backend combination passes 149/149, the full Django planner suite passes 376/376, and the focused frontend authorization suite passes 6/6. The historical YAML needed by the full suite was restored only as a colocated test fixture, not runtime or public data. |
| 2. stdio handshake and nine tools | Met | Real SDK client initialize/list/call smoke; exact inventory, structured invalid-input errors, clean child stderr. |
| 3. Local create then public read | Met with deterministic-harness limitation | Real local HTTP plus the current MCP source auto-provisioned a guest, created the first plan as READY, and fetched its public share. The second request was blocked with `limit=1` and `used=1`. A test-only WSGI harness normalized the no-Azure deterministic fallback draft to READY because production MCP rejects drafts; no paid external call was made. |
| 4. Localized share link resolves | Met | `http://localhost:3400/en/plans/oGnHee5L` returned HTTP 200 and the real plan title. |
| 5. Every error code reachable | Partial | The closed schema covers all 11 codes. Pending and expired login outcomes and the skill-level five-minute `generation_timeout` remain workflow branches rather than transport failures; root end-to-end verification remains. |
| 6. Credential permissions and leak proof | Met | The MCP store uses atomic writes, directory `0700`, files `0600`, bounded reads, symlink guards, persistent device identity, credential-only logout, a dormant `0600` revocation tombstone with retry-before-reprovision, and token redaction; permission tests and the token-leak scan pass. |
| 7. Codex plugin and whoami | Met | Plugin `0.1.2` was rebuilt and reinstalled; the Codex cache matches the source bundle and its MCP handshake lists all nine tools. |
| 8. Claude plugin | Met | Plugin `0.1.2` was rebuilt and reinstalled; the Claude cache matches the source bundle and its MCP handshake lists all nine tools. Claude Code correctly uses the required `/tripdremo:tripdremo` namespace. |
| 9. README | Met | Install, MCP/backend env vars, identity lifecycle, security/storage behavior, corrected transcripts, and host command difference documented. |
| 10. Approved backend round trip | Met for the local lifecycle | Real HTTP, Playwright, and the current MCP source verified guest auto-provisioning, first-plan READY/public retrieval, second-plan quota denial, pending-poll preservation, browser JWT approval with URL/analytics scrubbing, unchanged-token promotion, claimed account listing, and correct database ownership/marker/network/reservation state. Supporting suites pass MCP 84/84, focused backend 149/149, full planner 376/376, and frontend 6/6. The plan-generation step used the test-only deterministic READY normalization described in criterion 3, not a paid external AI call. |

## Phase 6 — Local-first planning and preserved cloud mode

This phase supersedes the earlier assumption that the plugin's normal planning command should delegate itinerary authorship to Tripdremo backend AI. It preserves all completed authentication, storage, security, public-read, and packaging work.

### Step 6.1 — Backend and quota split

- [x] Task: Expose the current Trip Plan v3 schema through a public read-only agent schema endpoint, including version and digest.
- [x] Task: Add an authenticated host-authored-plan submission endpoint that validates raw schema before external work, enriches deterministically, returns structured `needs_revision` issues, and persists only READY plans.
- [x] Task: Prove the local-first happy path cannot invoke Azure, Temporal AI, or AI repair.
- [x] Task: Keep the guest limit at one successful plan and add separate authenticated local-first limits: 50 successful plans plus 100 accepted enrichment starts/account/UTC day.
- [x] Task: Add 120/hour identity throttling, validation-before-ledger/budget behavior, renewable fenced 900-second leases, 30-day receipts, public-HTTPS URL enforcement, 12-child cap, and retryable provider outages.
- [x] Task: Retarget the preserved plugin backend-AI generator to `/trips/agent-generate/`, retain its smaller quota, and gate only that route with `TRIPDREMO_AGENT_BACKEND_AI_ENABLED=0`.
- [x] Task: Prove the normal website `/trips/generate/` behavior is unchanged.

### Step 6.2 — MCP and skills

- [x] Task: Add `tripdremo_get_plan_schema` and `tripdremo_submit_plan` with schema-conforming inputs, outputs, structured revision issues, and an internal UUID submission envelope hidden from MCP input.
- [x] Task: Give only `tripdremo_submit_plan` a configurable 300-second timeout while preserving the normal 30-second MCP request timeout.
- [x] Task: Retarget `tripdremo_create_plan` to the explicit gated agent backend-AI route without changing its public tool name.
- [x] Task: Rewrite `skills/tripdremo` as the default local-first workflow: schema fetch, host-authored complete plan, submit, at most two local repairs, and no automatic fallback.
- [x] Task: Create `skills/tripdremo-cloud` with `allow_implicit_invocation: false` for explicit backend-AI use only.
- [x] Task: Keep canonical cloud skill source Codex-valid and record the host split: Codex policy in `agents/openai.yaml`, Claude manual-invocation frontmatter injected only into its generated marketplace copy.
- [ ] Task: Package both skills and rebuild/reinstall the Codex and Claude plugin.

### Step 6.3 — Acceptance evidence

- [x] Task: Validate both skills with `quick_validate.py` and verify their referenced tool names, agent-only routes, quotas, and environment variable against the concurrent MCP/backend source.
- [x] Task: Run the final MCP build, typecheck, 99-test suite, stdio envelope checks, and exact expanded tool inventory.
- [x] Task: Run 88/88 focused backend tests and 424/424 full planner tests proving schema retrieval, local submission/revision and recovery, separate quotas/budgets, throttling, lease fencing, receipt retention, guest one-plan enforcement, zero backend-LLM calls, provider outage handling, agent cloud gating, and unchanged website generation.
- [ ] Task: Run an end-to-end host-authored plan submission through the rebuilt plugin and fetch its public share URL.
- [ ] Task: Re-run credential permission, token-leak, login/claim, and plugin installation checks after the expanded tool and two-skill bundle lands.

The hardened MCP local-first surface passes typecheck, build, and 109/109 tests. The backend passes 88/88 focused tests and 424/424 full planner tests. Rebuilt-plugin end-to-end evidence remains pending. The completed Section 10 evidence above remains the baseline for authentication and security behavior, not proof of the rebuilt host invocation path.

## Stop conditions

- Do not present the deterministic WSGI fallback normalization as production generation behavior; production MCP rejects draft plans.
- Do not claim installed-host behavior from manifest validation alone.
- Do not broaden guest access beyond one successful authenticated agent plan across local-first and cloud modes, plus public reads and local plan references; account listing, save, edit, and comment actions remain account-only.
- Do not describe the new local-first path as verified until a real host-authored plan passes deterministic submission and public retrieval with backend-LLM calls proven absent.
- Do not let plugin backend-AI gating alter the normal Tripdremo website generation endpoint.
