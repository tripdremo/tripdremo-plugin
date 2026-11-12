# Tripdremo agent surface

This repository packages Tripdremo for Codex and Claude Code:

- `mcp/` provides the TypeScript MCP server over stdio.
- `skills/tripdremo/` provides the default local-first planner: the current Codex or Claude host model authors the complete itinerary from Tripdremo's online Trip Plan v3 schema.
- `skills/tripdremo-cloud/` preserves explicit opt-in backend-AI generation for future use with weak or old host models.
- `plugin/` packages the MCP server, skills, and commands for both hosts.

The plugin's main logo is the canonical Tripdremo wordmark PNG. Its small square composer icon remains a separate brand-derived asset because the horizontal wordmark does not fit that slot.

## Planning modes

Normal `/tripdremo <request>` planning is local-first. The host model performs the itinerary reasoning and heavy lifting, calls `tripdremo_get_plan_schema` for the current online contract, authors complete Trip Plan v3 JSON, and submits it with `tripdremo_submit_plan`. Tripdremo then performs deterministic validation, image enrichment, maps and route calculations, and persistence. If validation returns `needs_revision`, the host repairs the structured issues locally and resubmits at most twice. This path makes no Tripdremo backend-LLM call.

The preserved cloud path is a separate explicit skill: Codex `/tripdremo-cloud`, or Claude Code's namespaced equivalent. It calls `tripdremo_create_plan`, which targets the agent-only `/trips/agent-generate/` endpoint. That endpoint is disabled by default with `TRIPDREMO_AGENT_BACKEND_AI_ENABLED=0`. It does not affect the normal Tripdremo website `/trips/generate/` endpoint.

The two modes never fall back to each other automatically. A future capability check may explicitly recommend the cloud skill for a weak or old host model, but this version does not guess model quality or silently spend backend AI.

### Local-first submission contract

- `tripdremo_get_plan_schema` is a public read. `tripdremo_submit_plan` requires the authenticated CLI identity; the MCP server silently provisions the guest identity when needed.
- The public MCP input contains `schema_version`, the original structured `request`, and the complete `plan`. The MCP server adds a private UUID v4 `submission_id` to the backend envelope; users and host models do not supply it.
- Before the one POST, the MCP server writes `pending-submission.json` with mode `0600`. It contains only the hidden UUID, payload hash, identity hash, and timestamp—never the prompt, plan, token, or email. For 24 hours, retrying the exact same plan after a timeout, lost response, `submission_in_progress`, or provider outage reuses that UUID; different content is blocked while the outcome is ambiguous.
- The MCP client does not automatically retry 429, 5xx, timeout, or ambiguous network failures. Backend replay protection scopes each `submission_id` to one authenticated identity and payload, uses a renewable fenced processing lease (900 seconds by default), and retains completed receipts for 30 days.
- A `needs_revision` response contains the submitted plan plus structured `{path, code, message, suggestion?}` issues. The host repairs that returned plan locally and makes a new submission, up to two repair attempts. Invalid raw plans do not persist or consume successful-plan quota.
- Submissions are capped at 1,000,000 request bytes and 240 total route stops, day places, and trip endpoints. An over-cap plan must be reduced locally before enrichment.
- Host-authored `sources[].url` and place `map_url` values must be empty or absolute HTTPS URLs on public hosts. Raw schema, location-cap, and unsafe-URL mistakes are rejected before the durable submission ledger and enrichment budgets; they still count toward the 120-requests-per-identity/hour throttle.
- Only a READY plan is persisted and counts toward the one successful guest plan or the separate authenticated local-first success quota. An account also has a separate durable budget of 100 accepted external-enrichment starts per UTC day. Deterministic enrichment can consume the applicable guest/account start budget even if the plan later needs revision or a provider returns retryable `enrichment_unavailable`; it does not consume the successful-plan allowance unless a Trip is stored.

## Identity and plan quota

Section 10 was approved on 2026-08-16. Every agent plan submission or generation call requires an authenticated server identity:

- On the first planning request, the MCP server automatically provisions a guest identity with an opaque CLI token. This does not open a browser or require account login.
- A persistent device may create exactly one successful guest plan over its lifetime. The server records that success separately from the current guest principal, so revoking, expiring, or replacing a CLI credential does not reset the allowance.
- Reprovisioning an inactive device creates a fresh guest principal. It never restores private ownership of plans belonging to the previous guest principal or a previously claimed account.
- Account users sign in through the browser device flow. Local-first submissions use a separate configurable quota of 50 successful stored plans plus 100 accepted external-enrichment starts per account per UTC day. Explicit backend-AI generation retains its own smaller quota.
- Browser approval upgrades the existing CLI token from guest to user and claims the guest identity's `Trip` and `GenerationJob` records for the signed-in account.

A synchronous failure or an asynchronous job that fails before creating a `Trip` releases the device's lifetime allowance for another attempt. The separate database-backed network budget counts every accepted guest generation start and is never decremented, including when generation later fails.

Registered account plan creation uses a shared database reservation across generation, YAML import, and shared-plan save. The same reservation serializes those operations with CLI plan claiming, preventing concurrent work from exceeding account quota. A stale reservation expires after one hour.

Public reads through `/share/<share_hash>/` remain anonymous. Backend account plan listing, saving, editing, and commenting require an account identity; the CLI can still show its locally recorded guest-plan references.

## Requirements

- Node.js 20 or newer
- npm
- Codex CLI for Codex installation checks
- Claude Code for Claude installation checks

## Build and test

Run all commands from the repository root:

```bash
cd /Users/dariuskasperavicius/www/private/tripdremo_ai
npm install
npm run build
npm test
npm run lint
```

`npm run build` compiles the MCP server and builds the plugin bundle. The bundle includes the compiled MCP server under `plugin/mcp/`; it does not download `@tripdremo/mcp` with `npx` at runtime.

With the Trips backend and frontend running locally, exercise the packaged MCP against a complete Trip Plan v3 submission:

```bash
npm run smoke:local -- /absolute/path/to/plan-submission.json
```

The smoke fetches the live schema, follows up to two structured revision responses, and verifies the resulting plan through the public share endpoint. It uses an isolated local development identity and temporary config directory.

### Verified Section 10 lifecycle

The complete Section 10 lifecycle passed against real local HTTP endpoints, the current MCP source, and Playwright browser authorization:

- The first planning request auto-provisioned a guest identity and returned a READY plan with a working public share URL.
- A second guest request was rejected with `limit: 1` and `used: 1`.
- A pending device-code poll preserved the login flow for later approval.
- Browser Supabase JWT approval removed the short code from the visible URL and analytics data.
- The same CLI token became a user identity, and account listing returned the claimed plan.
- Database checks confirmed account ownership, the persistent guest-success marker, one network accepted-start count, and cleared guest/account reservations.

This acceptance used the earlier backend-generation path and a test-only local WSGI harness with no Azure credentials or paid external call. The harness normalized the deterministic fallback draft to READY so the public-read and claim lifecycle could be exercised; production MCP behavior remained stricter and rejected draft plans.

The hardened MCP local-first surface passes typecheck, build, and 109/109 tests, including 24-hour pending-write recovery, hidden UUID envelopes, exact single-POST behavior, structured revision results, stdio transport, child caps, and backend-AI gating. The backend passes 88/88 focused tests and 424/424 full planner tests, including validation-before-ledger behavior, quotas, throttling, fenced leases, receipt retention, URL safety, retryable provider outages, and unchanged website generation. Rebuilt-plugin end-to-end evidence for schema → host-authored plan → deterministic submit/revision → public share remains pending. The existing authentication, claim, quota, permission, and token-leak evidence remains applicable.

## Configuration

All variables are optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRIPDREMO_API_BASE_URL` | `https://tripdremo.com/api/v1` | Tripdremo API root. |
| `TRIPDREMO_SITE_URL` | `https://tripdremo.com` | Base URL for absolute share and login links. |
| `TRIPDREMO_LOCALE` | `en` | Link locale: `en`, `lt`, `de`, or `pl`. |
| `TRIPDREMO_CONFIG_DIR` | `~/.tripdremo` | Local credential and plan-metadata directory. |
| `TRIPDREMO_DEV_USER` | unset | Sends `X-Travel-User` for local development only; non-loopback API URLs reject it. |
| `TRIPDREMO_TIMEOUT_MS` | `30000` | Normal MCP API-request timeout in milliseconds. |
| `TRIPDREMO_SUBMIT_TIMEOUT_MS` | `300000` | Timeout only for `tripdremo_submit_plan`, whose deterministic maps, geocoding, route calculations, and image enrichment can take longer; it does not extend other requests or enable backend AI. |
| `TRIPDREMO_LOG_LEVEL` | `warn` | `silent`, `error`, `warn`, `info`, or `debug`. |

For local API development:

```bash
TRIPDREMO_API_BASE_URL=http://localhost:8000/api/v1 \
TRIPDREMO_SITE_URL=http://localhost:3400 \
TRIPDREMO_DEV_USER=cli-smoke \
npm run build
```

`TRIPDREMO_DEV_USER` is a loopback-only development adapter that bypasses the production CLI identity flow. Non-loopback API URLs reject it.

### Backend identity configuration

The corresponding `trips-2026` backend uses these variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_TRIP_PLANS_PER_REGISTRATION` | `3` | Normal plan quota for an authenticated account. |
| `MAX_AGENT_LOCAL_PLANS_PER_REGISTRATION` | `50` | Successful host-model plans stored for one authenticated account. |
| `MAX_AGENT_LOCAL_ENRICHMENT_STARTS_PER_ACCOUNT_DAY` | `100` | Durable accepted external-enrichment starts per authenticated account and UTC day; starts are not refunded. |
| `MAX_AGENT_SUBMISSIONS_PER_IDENTITY_PER_HOUR` | `120` | Request throttle per authenticated CLI or account identity. |
| `AGENT_SUBMISSION_LEASE_SECONDS` | `900` | Renewable fenced processing lease for one backend submission attempt. |
| `AGENT_SUBMISSION_RETENTION_DAYS` | `30` | Retention for completed backend idempotency receipts. |
| `MAX_GUEST_TRIP_PLANS_PER_DEVICE` | `1` | Lifetime successful-plan quota for one persistent device; values other than `1` are rejected. |
| `MAX_GUEST_GENERATIONS_PER_NETWORK_DAY` | `3` | Database-backed daily cap on guest generations started from one normalized network. Account generation is unaffected. |
| `GUEST_ABUSE_HASH_SECRET` | falls back to `DJANGO_SECRET_KEY` in debug | HMAC secret for irreversible network-budget keys; production requires an explicit value of at least 32 bytes. |
| `CLI_SESSION_TTL_SECONDS` | `2592000` | Lifetime of an issued CLI credential. |
| `CLI_DEVICE_CODE_TTL_SECONDS` | `600` | Lifetime of the browser authorization code. |
| `CLI_DEVICE_POLL_INTERVAL_SECONDS` | `5` | Minimum client polling interval in seconds. |
| `CLI_DEVICE_THROTTLE_RATE` | `10/hour` | Per-normalized-network throttle for device provisioning. |
| `CLI_TRUSTED_PROXY_HOPS` | `0` | Number of rightmost forwarded hops to trust when the direct peer is in a configured trusted network. |
| `CLI_TRUSTED_PROXY_CIDRS` | empty | Comma-separated proxy networks permitted to supply `X-Forwarded-For`. |
| `TRIPDREMO_SITE_URL` | `http://localhost:3400` locally | Frontend origin used to build browser authorization links; production rejects loopback origins. |
| `TRIPDREMO_AGENT_BACKEND_AI_ENABLED` | `0` | Enables only explicit plugin cloud generation through `/trips/agent-generate/`; the website `/trips/generate/` path is unchanged. |

Guest abuse accounting stores a domain-separated HMAC-SHA256 key for the normalized client network and UTC date, never the raw address or network. IPv4 uses a `/32` identity and IPv6 uses `/64`; the same hashed network identity drives the device-issuance throttle. The backend accepts `X-Forwarded-For` only when `REMOTE_ADDR` belongs to `CLI_TRUSTED_PROXY_CIDRS` and `CLI_TRUSTED_PROXY_HOPS` is greater than zero; otherwise it uses the direct peer. A positive hop count without at least one valid trusted CIDR prevents backend startup. CIDRs configured with zero hops are inert, and forwarded addresses remain ignored. The database transaction locks and increments the counter for each accepted guest generation start, and the count is never decremented, so cache clearing or multiple app processes cannot reset the budget. Reaching the network cap returns typed code `guest_network_quota_exceeded`, HTTP 429, and `Retry-After` until the next UTC day. The lifetime one-successful-plan device quota remains independently enforced.

Apply backend migrations through `0022_agent_submission_leases_and_budget.py`. Migrations `0019`–`0020` persist the guest-success marker and account reservation; `0021`–`0022` add durable submission receipts, fenced leases, Trip linkage, and the account enrichment-start budget.

The backend exposes these identity routes under `/api/v1`:

| Endpoint | Authentication | Purpose |
| --- | --- | --- |
| `POST /cli/auth/device/` | New device or current CLI token | Provision a guest credential or renew the short authorization code. |
| `POST /cli/auth/token/` | Device code | Poll browser approval status. |
| `POST /cli/auth/approve/` | Supabase account session | Approve a short code and claim guest-owned plans and jobs. |
| `POST /cli/auth/revoke/` | CLI token | Revoke the current secret credential. |

Browser authorization is available at `/{locale}/cli/authorize?code=<user_code>` for `en`, `lt`, `de`, and `pl`.

## Install from the public marketplace

The repository is a marketplace source for both Codex and Claude Code. The plugin bundles its MCP server and runtime dependencies; installation does not execute `npx` or download an unpublished npm package.

The guided onboarding page is [tripdremo.com/en/connect-ai](https://tripdremo.com/en/connect-ai). Its browser prompt is useful for drafting an itinerary, but it cannot connect an account or save a Tripdremo share link until this integration is installed.

### Codex

```bash
codex plugin marketplace add tripdremo/tripdremo-plugin
codex plugin add tripdremo@tripdremo --json
codex plugin list
```

Restart Codex after installation, then try:

```text
/tripdremo plan a relaxed 5-day trip to the Dolomites for two adults
```

### Claude Code

```bash
claude plugin marketplace add tripdremo/tripdremo-plugin --scope user
claude plugin install tripdremo@tripdremo --scope user
claude plugin list
```

Restart Claude Code after installation, then try:

```text
/tripdremo:tripdremo plan a relaxed 5-day trip to the Dolomites for two adults
```

The provider-directory submission state and release checklist are tracked in [DISTRIBUTION.md](DISTRIBUTION.md).

## Privacy behavior

- Planning uses the current request, the current chat, and private sources the user explicitly selects.
- The agent asks before reading connected personal data and before saving an itinerary unless the user already asked to save it or create a Tripdremo link.
- Passwords, API keys, one-time passwords, Supabase tokens, and Tripdremo CLI tokens never belong in chat. Account connection uses Tripdremo's browser authorization flow.
- Saving creates a shareable Tripdremo link. The agent states this before submission.
- The human-readable planning brief is available at [tripdremo.com/ai/trip-planning-brief.txt](https://tripdremo.com/ai/trip-planning-brief.txt).

## Local plugin installation

The plugin build is expected to emit a local marketplace at `plugin/dist/marketplace` with the marketplace name `tripdremo-local`. After that directory exists, use these local verification commands.

### Codex

```bash
codex plugin marketplace add /Users/dariuskasperavicius/www/private/tripdremo_ai/plugin/dist/marketplace
codex plugin add tripdremo@tripdremo-local --json
codex plugin list
```

Start a new Codex thread after installation, then run:

```text
/tripdremo whoami
```

### Claude Code

```bash
claude plugin marketplace add /Users/dariuskasperavicius/www/private/tripdremo_ai/plugin/dist/marketplace --scope local
claude plugin install tripdremo@tripdremo-local --scope local
claude plugin list
```

Start a new Claude Code session after installation, then run:

```text
/tripdremo:tripdremo whoami
```

Claude Code always namespaces marketplace-plugin skills as `/plugin-name:skill-name`; it does not expose an unnamespaced `/tripdremo` alias. Codex uses `/tripdremo` as shown above. Approve the local read-only MCP call if Claude asks on first use.

The explicit backend-AI skill is `/tripdremo-cloud` in Codex and `/tripdremo:tripdremo-cloud` in Claude Code. Codex enforces manual invocation through `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. The canonical cross-host `SKILL.md` remains valid Codex skill source; during packaging, the plugin builder injects Claude-only `disable-model-invocation: true` into the generated Claude marketplace/install copy. Both hosts therefore prevent silent model selection while preserving direct user invocation.

For a session-only Claude smoke check, load the plugin directory directly:

```bash
claude --plugin-dir /Users/dariuskasperavicius/www/private/tripdremo_ai/plugin/dist/marketplace/plugins/tripdremo-claude
```

The `--plugin-dir` command is a smoke fallback, not the marketplace-install acceptance check. If `plugin/dist/marketplace` is absent, marketplace installation remains pending; do not substitute an invented marketplace path or claim installation succeeded.

## Command surface

The table uses the Codex spelling. In Claude Code, replace the `/tripdremo` prefix with `/tripdremo:tripdremo`; the subcommands and routing are identical.

The skill recognizes exactly these subcommands:

| Command | Behavior |
| --- | --- |
| `/tripdremo login` | Show the active or renewed short code, open browser authorization, and wait for account approval. |
| `/tripdremo logout` | Revoke and remove the secret CLI credential while preserving the device ID and local plan references. |
| `/tripdremo whoami` | Call the authentication-status tool and show the local identity state and API base URL. |
| `/tripdremo plans` | List account plans and locally recorded guest plans. |
| `/tripdremo open <share_hash>` | Retrieve a public plan by share hash and print its absolute share link. |
| `/tripdremo help` | Show these commands. |

`login`, `logout`, `whoami`, and `plans` are subcommands only when they are the complete argument string. `open` and `help` use first-token routing. Every other argument string is a planning request, including text that begins with `plan`, `create`, `get`, `list`, `status`, or `save`.

## Date and output rules

- A duration is inclusive of both endpoints. Five calendar days starting on `2027-07-04` ends on `2027-07-08`, not `2027-07-09`.
- A month without a year resolves to the next occurrence of that month relative to today. The skill states the chosen dates and proceeds.
- `end_date` must not precede `start_date`, and their difference must not exceed 45 days.
- Planning and normal `open` retrieval show the compact plan result: title, date range, day count, day summaries, and an absolute locale-prefixed share link.
- The full `trip_payload` is returned only when the user explicitly requests the full payload in natural language; it is not a separate public subcommand.

## Target transcript: guest creation

This transcript uses the Codex command spelling. In Claude Code, use `/tripdremo:tripdremo`. Because this document is dated 2026-08-16, “in July” resolves to July 2027. Five calendar days therefore use `2027-07-04` through `2027-07-08`. The first planning request silently provisions the guest CLI identity when submitting the host-authored plan.

```text
> /tripdremo plan a trip to the Dolomites, 5 days in July, 2 adults + a 6-year-old, relaxed pace

  Assumption: 4–8 Jul 2027 (5 calendar days).
  Tool: tripdremo_get_plan_schema
  Result: Trip Plan v3 schema + version digest

  The host model authors the complete itinerary locally.

  Tool: tripdremo_submit_plan
  Args: original structured request + complete Trip Plan v3 JSON

  If needed: repair returned structured issues locally and resubmit, at most twice.

  ✓ Dolomites: Passes, Lakes & Slow Mornings — 4–8 Jul 2027, 5 days

  Day 1  Bolzano → Ortisei · 2 stops · 48 min drive
  Day 2  Alpe di Siusi · 3 stops · walking day
  Day 3  Val Gardena · 3 stops · 35 min drive
  Day 4  Passo Gardena · 2 stops · 52 min drive
  Day 5  Ortisei → Bolzano · 2 stops · 46 min drive

  https://tripdremo.com/en/plans/<share_hash>

  Saved as a guest plan on this machine. Run `/tripdremo login` to keep it in your account.
```

The title, share hash, stops, and drive summaries above are illustrative placeholders. A real response must use only values returned by the MCP tools.

## Target transcript: login and plan claim

`login` reuses an unexpired short code or renews it. The browser uses the existing Supabase sign-in flow; approval keeps the CLI token unchanged while changing its server-side identity from guest to user. A pending poll preserves this flow for later approval. Replaying an already approved short code is idempotent only while that CLI session remains active. A revoked or expired session returns HTTP 410 instead of replaying the approval.

```text
> /tripdremo login

  Tool: tripdremo_login_start
  Args: open_browser=true

  Open this link and sign in:
    https://tripdremo.com/en/cli/authorize?code=<user_code>
  Code: <user_code>

  Tool: tripdremo_login_wait
  Args: timeout_seconds=120

  …waiting…
  ✓ Signed in as <account_email>
  ✓ 1 guest plan moved into your account: "Dolomites: Passes, Lakes & Slow Mornings"
```

Never put a password, one-time password, Supabase token, or Tripdremo CLI token in a command or tool argument.

## Local identity storage

The MCP server stores its state under `TRIPDREMO_CONFIG_DIR`:

- `device.json` contains the persistent, non-secret device UUID.
- `credentials.json` contains the secret CLI credential and active device-code login state.
- `pending-revocation.json` is a dormant `0600` tombstone created only when remote logout fails; it holds the previous token solely for a later revoke retry and is never treated as an active identity.
- `pending-submission.json` is a `0600` recovery marker for an ambiguous local-first write. It contains only a hidden UUID, payload hash, identity hash, and timestamp, expires after 24 hours, and makes an unchanged retry reuse the same backend submission identity.
- `plans.json` contains bounded local references to guest plans.

The directory uses mode `0700`; files use `0600` and atomic writes. Logout always removes `credentials.json` and preserves `device.json`, `plans.json`, and all server-side plans. It does not let pending write metadata cross into a different credential identity. If remote revocation fails, the next logout or identity provisioning retries the tombstoned token before creating a replacement credential. A successful revoke or a definitive `not_authenticated` response deletes the tombstone; other failures retain it and stop reprovisioning. Reprovisioning creates a fresh guest principal: local public-plan references remain, but old private plan ownership is never attached to the replacement principal. The persistent server-side success marker continues to block a second guest plan after the device has created one successfully.

## Other subcommands

```text
/tripdremo login      /tripdremo logout      /tripdremo whoami
/tripdremo plans                      # list account and local guest plans
/tripdremo open <share_hash>           # retrieve and print the public share link
/tripdremo help
/tripdremo <anything else>             # treat as a planning request
```
