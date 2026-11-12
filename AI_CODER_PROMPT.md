# Build the Tripdremo agent surface: MCP server + skill + Codex plugin

You are implementing a new product surface for **Tripdremo** (an AI trip planner). The goal is
that a user sitting in Codex CLI (or Claude Code) can type:

```
/tripdremo plan a trip to the Dolomites, 5 days in July, 2 adults + a 6-year-old, relaxed pace
```

…get a real generated plan and a shareable link back in the terminal **without logging in first**,
and then, whenever they want:

```
/tripdremo login
```

…sign in and have the plan they already generated end up in their account.

Build it in **`/Users/dariuskasperavicius/www/private/tripdremo`** (currently contains three empty
directories: `mcp/`, `plugin/`, `skil/` — note the typo; rename `skil/` to `skills/`).

---

## 0. How to work

- Read this whole document before writing code.
- **Write the plan first**: `docs/plans/2026-08-16-tripdremo-agent-surface.md`, structured
  Phase → Step → Task, every task tagged `— model: <fable 5 | opus 4.8 | sonnet 4.6 | haiku 4.5>`.
  Section 13 below is the skeleton; expand it, do not replace it.
- **Contract-first**: JSON Schemas in `contracts/` land before the code that produces or consumes
  them. Consumers branch on machine-readable `code` fields, never on human-readable `message` text.
- **Simplicity first**: build the minimum that satisfies section 12. Everything in section 11 is
  explicitly out of scope for v1 — do not build it "while you're in there".
- Ask the questions in section 14 **before** starting Phase 2. Everything before that is unblocked.

---

## 1. Ground truth about the existing system

The Tripdremo app lives in a **separate repo** at `/Users/dariuskasperavicius/www/tools/trips-2026`
(Next.js 15 frontend + Django 5.2 REST backend). Treat it as **read-only reference** unless
section 10 says otherwise. Facts below are verified against that repo — do not re-derive them, and
do not guess at anything not listed here; go read the file instead.

### API base URLs

| Environment | Base |
|---|---|
| Production | `https://tripdremo.com/api/v1` (Next proxies `/api/v1/*` to Django — `app/api/v1/[...path]/route.ts`) |
| Local dev | `http://localhost:8000/api/v1` (Django direct) or `http://localhost:3400/api/v1` (through Next) |

Site URL for share links: `https://tripdremo.com` (local: `http://localhost:3400`).

### Endpoints you will use (`backend/planner/urls.py`)

| Method + path | Auth | Notes |
|---|---|---|
| `GET  /health/` | AllowAny | liveness |
| `POST /trips/generate/` | **required** | creates a plan |
| `GET  /generation-jobs/<id>/progress/` | required, owner-scoped | poll async generation |
| `GET  /trips/` | required | list own plans (paginated, `PAGE_SIZE=20`) |
| `GET  /trips/<id>/` | required | detail |
| `GET  /trips/by-share/<share_hash>/` | required, owner-scoped | private read |
| `GET  /share/<share_hash>/` | **AllowAny** | public read of a READY plan |
| `POST /share/<share_hash>/save/` | required | copies a shared plan into the caller's account |
| `POST /trips/<id>/adjust/` | required | out of scope for v1 |

### `POST /trips/generate/` request contract

From `GenerateTripRequestSerializer` (`backend/planner/serializers.py:37`):

```jsonc
{
  "prompt":      "string, required, max 4000",
  "origin":      "string, optional, may be blank",
  "destination": "string, optional, may be blank",
  "start_date":  "YYYY-MM-DD, required",
  "end_date":    "YYYY-MM-DD, required",   // >= start_date, span <= 45 days
  "adults":      2,                         // int 1..12, default 2
  "children":    [{ "age": 6 }],            // default []
  "style":       "balanced",                // relaxed | balanced | active | camper | luxury
  "budget":      "comfortable",             // value | comfortable | premium
  "constraints": {}                          // free-form JSON object
}
```

### `POST /trips/generate/` responses (`backend/planner/views.py:260`)

- **201** — synchronous completion; body is a `TripDetail` object.
- **202** — async (Temporal) path:
  ```jsonc
  {
    "status": "generating",
    "generation_job": { "id": 12, "status": "...", "progress_status": "...", "progress_step": "...", "trip_id": null, "error": "" },
    "workflow": { "id": "...", "run_id": "...", "task_queue": "..." },
    "progress_url": "/api/v1/generation-jobs/12/progress/"
  }
  ```
  Poll `progress_url`; the response gains a `trip` key when done, and `generation_job.status == "failed"`
  with `generation_job.error` on failure.
- **403** — quota: `{ "detail": "...", "limit": n, "used": n }` (`_trip_plan_quota_response`,
  `MAX_TRIP_PLANS_PER_REGISTRATION`, default `3`; bypassed when `APP_DEBUG`).
- **502** — `{ "detail": "..." }` generation failure.

### Trip object shape (`TripListSerializer` / `TripDetailSerializer` / `SharedTripSerializer`)

```jsonc
{
  "id": 42, "title": "...", "subtitle": "...", "destination": "...",
  "dates": { "start": "2026-07-04", "end": "2026-07-09" },
  "status": "ready",                 // draft | generating | ready | failed
  "share_hash": "ab12cd34",
  "share_url": "/plans/ab12cd34",    // PATH ONLY — no host, no locale
  "hero_image": "https://…",
  "created_at": "…", "updated_at": "…",
  "request_payload": { … },          // detail only
  "trip_payload": { "data": { "trip": …, "route": …, "days": [ … ], "packing": … } }
}
```

**Building the user-facing link:** `share_url` is a bare path. The web app is locale-prefixed
(`localePrefix: "always"` in `middleware.ts`; locales `en | lt | de | pl`, default `en`). The correct
link is:

```
{SITE_URL}/{locale}/plans/{share_hash}       →  https://tripdremo.com/en/plans/ab12cd34
```

### Authentication as it exists today

`backend/config/settings.py:160` —
```python
"DEFAULT_AUTHENTICATION_CLASSES": [
    "planner.auth.SupabaseJWTAuthentication",   # Authorization: Bearer <supabase jwt>
    "planner.auth.DemoHeaderAuthentication",    # X-Travel-User: <key>  — DEV ONLY
    "rest_framework.authentication.SessionAuthentication",
],
"DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
```

Critical constraints:

1. `DemoHeaderAuthentication` is gated by `DJANGO_ALLOW_DEMO_AUTH`, and `settings.py` **raises
   `ImproperlyConfigured` if it is enabled in production**. It is a local-dev tool only.
2. `CORS_ALLOW_HEADERS = ["accept", "authorization", "content-type", "x-travel-user"]`.
3. The web frontend already refuses anonymous generation — `lib/backend-api.ts` calls
   `/trips/generate/` with `requireRegisteredUser: true` and throws
   *"Sign up or log in to create travel plans."* when there is no Supabase session.
4. Frontend auth is Supabase email/password (`lib/supabase-auth.ts`). **No OAuth provider is
   configured**, so any CLI design that assumes a Supabase OAuth redirect is wrong.

**Therefore: "generate without logging in" is not possible against the API as it stands today.**
Section 10 specifies the backend change required. Section 13 sequences the work so the MCP server,
skill, and plugin are all built and testable against local dev *before* that change lands.

---

## 2. Target UX (write these transcripts into the README as the spec)

### Guest generation — the primary path

```
> /tripdremo plan a trip to the Dolomites, 5 days in July, 2 adults + a 6-year-old, relaxed pace

  Planning… (this usually takes 1–3 minutes)
  ✓ Dolomites: Passes, Lakes & Slow Mornings — 4–9 Jul 2026, 5 days

  Day 1  Bolzano → Ortisei · 2 stops · 48 min drive
  Day 2  Alpe di Siusi · 3 stops · walking day
  …

  https://tripdremo.com/en/plans/ab12cd34

  Saved as a guest plan on this machine. Run `/tripdremo login` to keep it in your account.
```

### Login afterwards — the plan follows the user

```
> /tripdremo login

  Open this link and sign in:
    https://tripdremo.com/en/cli/authorize?code=BXKQ-7T2M
  Code: BXKQ-7T2M

  …waiting…
  ✓ Signed in as darius@example.com
  ✓ 1 guest plan moved into your account: "Dolomites: Passes, Lakes & Slow Mornings"
```

### Other subcommands

```
/tripdremo login      /tripdremo logout      /tripdremo whoami
/tripdremo plans                      # list plans (account + local guest plans)
/tripdremo open ab12cd34              # print/open the share link
/tripdremo <anything else>            # treated as a planning request
```

---

## 3. Locked decisions

Do not re-litigate these; if you think one is wrong, raise it in your Phase 0 report and wait.

1. **Language/runtime:** TypeScript, Node ≥ 20, ESM. MCP server uses the official
   `@modelcontextprotocol/sdk` over **stdio**.
2. **Three artifacts, one repo, clean seams.** The MCP server knows nothing about prompts or
   formatting; the skill knows nothing about HTTP; the plugin is packaging only.
3. **Natural-language parsing lives in the skill, not the server.** The MCP tools take structured
   arguments. The model converts free text → arguments. Never ship a regex date parser in the server.
4. **Generation is never blocked on synchronously.** `create_plan` returns a job handle. The skill
   polls. A bounded `wait_seconds` convenience parameter is allowed (default `0`, max `120`).
5. **One credential, upgraded in place.** The CLI holds a single opaque Tripdremo CLI token that
   starts as a guest identity and becomes a user identity after login. See section 9.
6. **The CLI and the agent never see a password, an email OTP, or a Supabase token.** All credential
   entry happens in the user's browser. The MCP server refuses to accept a password parameter at all.
7. **Claiming happens server-side at approval time**, not by the CLI replaying share hashes.
8. `/tripdremo` is a single command with subcommand routing. `/tripdremo-login` may exist as a
   discoverable alias that forwards to the same logic.

---

## 4. Deliverable layout

```
/Users/dariuskasperavicius/www/private/tripdremo/
├── README.md                      # install + usage + the section-2 transcripts
├── AI_CODER_PROMPT.md             # this file — leave it in place
├── package.json                   # npm workspaces root: ["mcp"]
├── .gitignore  .editorconfig  tsconfig.base.json
├── docs/plans/2026-08-16-tripdremo-agent-surface.md
├── contracts/
│   ├── tripdremo-plan-request.v1.schema.json
│   ├── tripdremo-plan-result.v1.schema.json
│   ├── tripdremo-auth-state.v1.schema.json
│   └── tripdremo-error.v1.schema.json
├── mcp/                           # package @tripdremo/mcp
│   ├── package.json  tsconfig.json
│   ├── bin/tripdremo-mcp.mjs      # shebang entrypoint, published as a bin
│   ├── src/
│   │   ├── index.ts               # stdio wiring only
│   │   ├── server.ts              # tool registration
│   │   ├── config.ts              # env + defaults, single source of truth
│   │   ├── tools/*.ts             # one file per tool
│   │   ├── api/client.ts          # typed fetch, retries, error mapping
│   │   ├── auth/store.ts          # ~/.tripdremo/credentials.json, mode 0600
│   │   ├── auth/device.ts         # device-code login handshake
│   │   ├── format/summary.ts      # trip payload → compact text summary
│   │   └── errors.ts              # TripdremoError + code enum
│   └── test/                      # node:test, no network
├── skills/tripdremo/
│   ├── SKILL.md
│   └── references/
│       ├── request-building.md    # free text → generate args, incl. date resolution
│       ├── auth.md                # guest vs signed-in, what to tell the user
│       ├── output.md              # how to render a plan in the terminal
│       └── troubleshooting.md     # error code → user-facing action
└── plugin/
    ├── .codex-plugin/plugin.json
    ├── .claude-plugin/plugin.json
    ├── .mcp.json
    ├── commands/
    │   ├── tripdremo.md           # Claude-flavoured, uses $ARGUMENTS
    │   └── tripdremo.toml         # Codex-flavoured, uses {{args}}
    ├── skills/tripdremo/          # build-copied from ../skills (do NOT ship a symlink)
    ├── assets/{logo.svg,composerIcon.svg}
    └── scripts/build-plugin.mjs   # copies skills/, validates manifests
```

---

## 5. Contracts and error codes

Every tool returns, on failure, a structured error conforming to `tripdremo-error.v1.schema.json`:

```jsonc
{ "error": { "code": "quota_exceeded", "message": "human text", "retryable": false, "details": { … } } }
```

Closed set of `code` values for v1 — the skill branches on these and nothing else:

| code | meaning | what the skill should do |
|---|---|---|
| `not_authenticated` | no valid CLI token | run the login flow |
| `login_pending` | device approval not completed yet | keep polling / re-open link |
| `login_expired` | user code expired | restart login |
| `quota_exceeded` | plan limit for this identity | explain limit, offer login/upgrade |
| `invalid_request` | 400 from the API, field errors in `details` | fix args, retry once |
| `generation_failed` | job failed | show `details.reason`, offer retry |
| `generation_timeout` | still running when the wait budget ran out | tell the user, hand back the job id |
| `plan_not_found` | unknown share hash / trip id | check the id |
| `rate_limited` | 429 | back off, report the wait |
| `backend_unreachable` | network/DNS/5xx after retries | report the base URL being used |
| `internal` | anything else | report, include a short id |

Success payloads must validate against `tripdremo-plan-result.v1.schema.json`, which carries at
minimum: `share_hash`, `share_url` (absolute, locale-prefixed), `title`, `subtitle`, `destination`,
`dates {start,end}`, `day_count`, `status`, `owner_kind` ("guest" | "user"), and `days[]` with
`{index, title, stop_count, drive_summary}`. Do **not** dump the entire `trip_payload` into the tool
result — it is large. Provide it only when the caller passes `include_payload: true`.

---

## 6. MCP server specification

### Configuration (env, all optional, resolved in `config.ts`)

| Var | Default | Purpose |
|---|---|---|
| `TRIPDREMO_API_BASE_URL` | `https://tripdremo.com/api/v1` | API root |
| `TRIPDREMO_SITE_URL` | `https://tripdremo.com` | link building |
| `TRIPDREMO_LOCALE` | `en` | link locale; must be one of `en,lt,de,pl` |
| `TRIPDREMO_CONFIG_DIR` | `~/.tripdremo` | credential + guest-plan storage |
| `TRIPDREMO_DEV_USER` | unset | when set, send `X-Travel-User: <value>` instead of a CLI token (local dev only; must be refused when the API base is not localhost) |
| `TRIPDREMO_TIMEOUT_MS` | `30000` | per-request timeout |
| `TRIPDREMO_LOG_LEVEL` | `warn` | `silent\|error\|warn\|info\|debug` |

### Tools (v1 — exactly these)

| Tool | Input | Output |
|---|---|---|
| `tripdremo_auth_status` | `{}` | `{ authenticated, kind: "none"\|"guest"\|"user", email?, device_id, plans_used?, plans_limit?, api_base_url }` |
| `tripdremo_login_start` | `{ open_browser?: boolean = true }` | `{ user_code, verification_uri, verification_uri_complete, expires_in, interval }` |
| `tripdremo_login_wait` | `{ timeout_seconds?: number = 120 }` | `{ status: "approved"\|"pending"\|"expired", email?, claimed_plans?: [{share_hash,title}] }` |
| `tripdremo_logout` | `{}` | `{ ok: true }` |
| `tripdremo_create_plan` | the generate contract from §1 + `{ wait_seconds?: number = 0 }` | `{ status: "ready", plan }` or `{ status: "generating", job_id, progress_url, poll_after_seconds }` |
| `tripdremo_plan_status` | `{ job_id }` | `{ status: "generating"\|"ready"\|"failed", step?, plan?, error? }` |
| `tripdremo_get_plan` | `{ share_hash, include_payload?: false }` | `{ plan }` — uses the public `share/` endpoint, works with no auth |
| `tripdremo_list_plans` | `{ limit?: 20 }` | `{ account: [...], guest_local: [...] }` |
| `tripdremo_save_plan_to_account` | `{ share_hash }` | `{ plan }` — `POST /share/<hash>/save/`; requires a user identity |

### Implementation requirements

- **stdout is JSON-RPC only.** All logging goes to stderr. A stray `console.log` breaks the
  transport — add a lint rule or a test that asserts a clean handshake.
- Register `inputSchema` for every tool with descriptions on each field; the model reads them.
- `api/client.ts`: one `fetch` wrapper. Retries only on `429` and `5xx`, max 3 attempts, exponential
  backoff with jitter, honours `Retry-After`. Never retries `4xx`. Maps every failure to a
  `TripdremoError` with a code from §5.
- Send `User-Agent: tripdremo-mcp/<version> (+https://tripdremo.com)` on every request.
- `auth/store.ts`: writes `~/.tripdremo/credentials.json` with mode `0600`, creating the directory
  `0700`. Reads tolerate a missing/corrupt file by treating the user as logged out. **Never** log,
  echo, or return a token — redact to `cli_…abcd` in any diagnostic.
- Guest plans generated on this machine are recorded in `~/.tripdremo/plans.json` (share_hash, title,
  created_at) so `list_plans` and the post-login summary can mention them. This file holds no secrets.
- `format/summary.ts` renders the compact day list shown in §2. Keep it under ~40 lines of output
  for a 7-day trip.
- Tests (`node:test`, no network): error mapping table, share-URL construction across all four
  locales, credential store permissions, request-builder validation (span > 45 days rejected,
  `end_date < start_date` rejected), and an stdio smoke test that lists tools.

---

## 7. Skill specification (`skills/tripdremo/SKILL.md`)

Frontmatter:

```yaml
---
name: tripdremo
description: Plan a real trip with Tripdremo and get a shareable itinerary link, or sign in to a Tripdremo account. Use when the user asks to plan, generate, or save a trip or itinerary, asks for a Tripdremo link, or types /tripdremo.
---
```

The body must cover:

1. **Subcommand routing.** First token of the argument decides: `login`, `logout`, `whoami`,
   `plans`, `open <hash>`, `help`. Anything else is a planning request. Never treat a planning
   request as a subcommand because it happens to start with a matching word — require an exact,
   argument-free match for `login`/`logout`/`whoami`/`plans`.
2. **Free text → generate arguments.** Delegate the detail to `references/request-building.md`:
   - `prompt` is always the user's original text, verbatim.
   - Resolve relative/vague dates to concrete `YYYY-MM-DD` using today's date. "5 days in July" with
     no year → the *next* July. Pick a concrete range, state the assumption in the reply, and
     proceed. Respect the 45-day cap.
   - Infer `adults`/`children[].age` from phrasing ("2 adults + a 6-year-old"); default `adults: 2`,
     `children: []`.
   - Map pace/vibe words to the `style` enum and money words to the `budget` enum; when nothing
     maps, use the defaults and do not mention it.
   - **Ask at most one clarifying question, and only when the destination is genuinely absent.**
     Missing dates are an assumption, not a question.
3. **The waiting protocol.** Call `tripdremo_create_plan` with `wait_seconds: 60`. If it returns
   `generating`, tell the user it usually takes 1–3 minutes, then poll `tripdremo_plan_status` at the
   returned interval. Report progress steps as they change; do not spam identical lines. Give up
   after ~5 minutes with `generation_timeout` and hand the user the job id and link to check later.
4. **Auth guidance.** Generation works as a guest. After a guest plan succeeds, add exactly one line
   offering `/tripdremo login`. Do not nag on every turn. On `not_authenticated` from an
   account-only tool, run `tripdremo_login_start`, show the code and URL, then `tripdremo_login_wait`.
5. **Output rendering** per `references/output.md`: title, date range, day count, the compact day
   list, then the link on its own line. The link is the deliverable — it is always present, always
   absolute, and never buried mid-paragraph.
6. **Error handling** per `references/troubleshooting.md`: one row per error code from §5 with the
   exact user-facing sentence and the next action. Never invent a plan, a link, or a share hash.

---

## 8. Codex plugin specification

The manifest formats below are copied from working plugins in `~/.codex/plugins/cache` — match them
exactly.

`plugin/.codex-plugin/plugin.json`:

```jsonc
{
  "name": "tripdremo",
  "version": "0.1.0",
  "description": "Plan real trips with Tripdremo and get a shareable itinerary link, straight from the CLI.",
  "author": { "name": "Tripdremo", "url": "https://tripdremo.com" },
  "homepage": "https://tripdremo.com",
  "license": "Proprietary",
  "keywords": ["travel", "trip", "itinerary", "planning", "tripdremo"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Tripdremo",
    "shortDescription": "Plan a trip, get a shareable itinerary link.",
    "longDescription": "…",
    "developerName": "Tripdremo",
    "category": "Productivity",
    "capabilities": ["Read", "Write"],
    "websiteURL": "https://tripdremo.com",
    "defaultPrompt": [
      "Plan a 5-day trip to the Dolomites in July for 2 adults and a 6-year-old",
      "Plan a relaxed week in northern Portugal by camper",
      "Sign me in to Tripdremo"
    ],
    "brandColor": "#…",
    "composerIcon": "./assets/composerIcon.svg",
    "logo": "./assets/logo.svg"
  }
}
```

`plugin/.mcp.json`:

```jsonc
{ "mcpServers": { "tripdremo": { "command": "node", "args": ["./mcp/bin/tripdremo-mcp.mjs"], "cwd": "." } } }
```

Decide and document how `mcp/` reaches the packaged plugin — either the build script bundles the
built server into `plugin/mcp/`, or `.mcp.json` invokes `npx -y @tripdremo/mcp`. Pick one, state why
in the README, and make `scripts/build-plugin.mjs` enforce it. A plugin that ships a manifest
pointing at a path that does not exist inside the bundle is a failed deliverable.

Commands. `commands/tripdremo.md` (Claude flavour) uses `$ARGUMENTS`; `commands/tripdremo.toml`
(Codex flavour) wraps the same body in `prompt = """ … """` and ends with `User request: {{args}}`.
Keep the two generated from one source in `build-plugin.mjs` so they cannot drift — the PostHog
plugin does exactly this and marks the generated file with a "do not edit manually" header.

Both command bodies do one thing: invoke the `tripdremo` skill with the raw arguments. Do not
duplicate the skill's logic into the command file.

Also emit `plugin/.claude-plugin/plugin.json` (same `name`/`version`/`description`/`author` block,
no `interface` key) so the bundle installs in Claude Code as well as Codex.

Verification: install locally and confirm `/tripdremo` appears, the MCP server connects, and
`tripdremo_auth_status` returns without an error. Document the exact install command in the README.

---

## 9. Auth specification

### Identity model

The CLI holds **one opaque token**, `cli_<random>`, in `~/.tripdremo/credentials.json`.

- On first use, the MCP server calls `POST /cli/auth/device/` with a locally generated, persistent
  `device_id` (UUIDv4, stored alongside the token). The backend returns the token immediately, bound
  to a **guest identity**, plus a short `user_code` for later upgrade.
- Guest identity can generate plans (subject to a small quota) and read its own plans. It cannot
  list an account, comment, or edit.
- `/tripdremo login` opens `{SITE_URL}/{locale}/cli/authorize?code=<user_code>`. The user signs in
  **in the browser** with the existing Supabase email/password auth. That page calls
  `POST /cli/auth/approve/` with their Supabase Bearer token.
- On approval the backend attaches the CLI session to the real user **and re-parents every trip the
  guest identity created on that `device_id`**. The CLI's token does not change — it is now a user
  identity. This is what makes "generate first, log in later" work.
- The CLI learns about approval by polling `POST /cli/auth/token/` with its `device_code` at the
  returned `interval` (respect it; do not poll faster).

### Hard rules

- The MCP server has **no parameter that accepts a password, an OTP, or a Supabase token**. If a
  caller tries, return `invalid_request`.
- Tokens are never written to stdout, never included in tool results, never logged. Redact to
  `cli_…` + last 4 chars in diagnostics.
- `logout` deletes the local credential file and calls a revoke endpoint if one exists; a failed
  revoke still clears local state, and says so.
- `TRIPDREMO_DEV_USER` (the `X-Travel-User` shortcut) must be **refused** unless the resolved API
  base URL host is `localhost` or `127.0.0.1`. Fail loudly, do not silently downgrade.

---

## 10. Cross-repo dependency — read carefully

Sections 2 and 9 cannot work in production without changes to
`/Users/dariuskasperavicius/www/tools/trips-2026`. That repo is not in the scope the user named, and
this change adds an **unauthenticated write surface that costs LLM money per call**. So:

> **Do not start section 10 work without explicit approval.** Present the design, the quota story,
> and the abuse surface, and get a yes first. Build Phases 1–3 against local dev in the meantime.

When approved, the backend change is:

1. **Model `CliSession`** (`backend/planner/models.py`): `token_hash` (never the raw token),
   `device_id`, `device_name`, `kind` (`guest`|`user`), `user` FK (null for guest),
   `guest_user` FK (the throwaway Django user that owns guest trips), `user_code` (null after
   approval), `created_at`, `approved_at`, `expires_at`, `last_used_at`, `revoked_at`.
2. **`CliTokenAuthentication`** in `backend/planner/auth.py`, added to
   `DEFAULT_AUTHENTICATION_CLASSES` **after** `SupabaseJWTAuthentication`. Resolves
   `Authorization: Bearer cli_…` to the session's user (guest user or real user). Rejects revoked
   and expired sessions.
3. **Endpoints** under `/api/v1/cli/auth/`:
   - `POST device/` (AllowAny) → `{ cli_token, device_code, user_code, verification_uri,
     verification_uri_complete, expires_in, interval }`
   - `POST token/` (AllowAny) → `{ status: "pending" }` (HTTP 200, not an error) or
     `{ status: "approved", email, claimed_plans: [...] }`
   - `POST approve/` (IsAuthenticated, called by the web page) → attaches the session, re-parents
     `Trip.objects.filter(owner=session.guest_user)` to `request.user`, returns the claimed list
   - `POST revoke/` (CLI token auth) → revokes the caller's session
4. **Guest quota**: a new `MAX_GUEST_TRIP_PLANS_PER_DEVICE` setting (recommend default `1`), enforced
   in `_trip_plan_quota_response` when the identity is a guest. Existing
   `MAX_TRIP_PLANS_PER_REGISTRATION` continues to apply to real users. Rate-limit `POST device/`
   by IP.
5. **Frontend page** `app/[locale]/cli/authorize/page.tsx`: shows the `user_code`, requires a
   Supabase session (reuse the existing login modal), calls `approve/`, confirms success. Add a
   localized string set for all four locales.
6. **Tests** in `backend/planner/tests_cli_auth.py`: guest generation, quota, approve-then-reparent,
   double-approve is a no-op, expired code, revoked token, and that `DemoHeaderAuthentication`
   remains disabled in production config.

**If approval is withheld**, fall back to: generation requires login, `/tripdremo login` runs first,
and the guest path is dropped from v1. Say so in the README rather than shipping a flow that only
works on localhost.

---

## 11. Non-goals for v1

Do not build, and do not leave half-built stubs for: plan editing / the editable-plan and
recalculation endpoints, AI draft changes, `trips/<id>/adjust/`, comments, packing, budget, YAML
import, a standalone CLI binary separate from the MCP server, a hosted/remote MCP transport, Cursor
or Gemini plugin manifests, telemetry, and i18n of CLI output (English only in v1; the *link* is
localized, the terminal text is not).

---

## 12. Acceptance criteria

The work is done when all of these are true and you have shown the evidence:

1. `npm run build && npm test` pass at the repo root.
2. `node mcp/bin/tripdremo-mcp.mjs` completes an MCP handshake and lists exactly the nine tools in
   §6, with no non-JSON bytes on stdout.
3. Against local dev (`make start` in trips-2026, `TRIPDREMO_API_BASE_URL=http://localhost:8000/api/v1`,
   `TRIPDREMO_DEV_USER=cli-smoke`): `tripdremo_create_plan` produces a real plan, and
   `tripdremo_get_plan` reads it back by share hash. Paste the actual tool output.
4. The share link printed is absolute, locale-prefixed, and resolves in a browser.
5. Every error code in §5 is reachable and covered by a test.
6. `~/.tripdremo/credentials.json` is mode `0600`; no token appears in any log line, tool result, or
   test fixture. Show the `ls -l` and a grep proving it.
7. The plugin installs in Codex, `/tripdremo` is listed, and `/tripdremo whoami` answers.
8. The plugin installs in Claude Code and `/tripdremo` is listed.
9. `README.md` documents install, env vars, the guest→login flow, and the §2 transcripts.
10. If section 10 was approved and implemented: `cd backend && .venv/bin/python manage.py test planner`
    passes, and a guest-generate → login → re-parent round trip is demonstrated end to end.

State plainly which criteria are unmet and why, rather than reporting done.

---

## 13. Phase plan skeleton

Expand this into `docs/plans/2026-08-16-tripdremo-agent-surface.md`. Keep the model tags.

### Phase 0 — Ground and decide
- Step 0.1 — Confirm the shape
  - [ ] Task: Re-verify every API fact in §1 against trips-2026 and note any drift — model: sonnet 4.6
  - [ ] Task: Answer §14 questions with the user; record decisions in the plan doc — model: opus 4.8
  - [ ] Task: Write the plan doc and the contracts in `contracts/` — model: fable 5

### Phase 1 — MCP server core
- Step 1.1 — Skeleton
  - [ ] Task: Workspace, tsconfig, lint, `node:test` harness — model: haiku 4.5
  - [ ] Task: `config.ts` + `errors.ts` + the §5 error map with tests — model: sonnet 4.6
- Step 1.2 — API layer
  - [ ] Task: `api/client.ts` with retry/backoff/timeout and error mapping — model: sonnet 4.6
  - [ ] Task: Share-URL builder covering all four locales, with tests — model: haiku 4.5
- Step 1.3 — Planning tools
  - [ ] Task: `tripdremo_create_plan` + `tripdremo_plan_status`, incl. the 202/poll path — model: opus 4.8
  - [ ] Task: `tripdremo_get_plan`, `tripdremo_list_plans`, `format/summary.ts` — model: sonnet 4.6
  - [ ] Task: stdio smoke test asserting a clean handshake and tool list — model: sonnet 4.6

### Phase 2 — Auth
- Step 2.1 — Local identity
  - [ ] Task: `auth/store.ts` with 0600 perms, redaction, corrupt-file tolerance — model: sonnet 4.6
  - [ ] Task: `TRIPDREMO_DEV_USER` path with the localhost-only guard — model: haiku 4.5
- Step 2.2 — Device flow
  - [ ] Task: `auth/device.ts` + `login_start` / `login_wait` / `logout` / `auth_status` — model: opus 4.8
  - [ ] Task: `tripdremo_save_plan_to_account` — model: sonnet 4.6

### Phase 3 — Skill and plugin
- Step 3.1 — Skill
  - [ ] Task: `SKILL.md` with subcommand routing and the waiting protocol — model: fable 5
  - [ ] Task: The four `references/*.md` files — model: opus 4.8
- Step 3.2 — Plugin
  - [ ] Task: Manifests, `.mcp.json`, assets — model: haiku 4.5
  - [ ] Task: `build-plugin.mjs` (skill copy, md→toml generation, manifest validation) — model: sonnet 4.6
  - [ ] Task: Install and verify in both Codex and Claude Code; capture evidence — model: sonnet 4.6

### Phase 4 — Backend (only after §10 approval, in trips-2026)
- Step 4.1 — Server
  - [ ] Task: `CliSession` model + migration — model: sonnet 4.6
  - [ ] Task: `CliTokenAuthentication` + settings wiring + guest quota — model: opus 4.8
  - [ ] Task: `/cli/auth/*` endpoints incl. re-parenting on approve — model: fable 5
  - [ ] Task: `planner.tests_cli_auth` covering §10.6 — model: sonnet 4.6
- Step 4.2 — Web
  - [ ] Task: `app/[locale]/cli/authorize` page + 4-locale strings — model: sonnet 4.6
- Step 4.3 — Wire up
  - [ ] Task: Point the MCP server at the real flow; end-to-end guest→login→claim evidence — model: opus 4.8

### Phase 5 — Ship
- [ ] Task: README with install, env, transcripts, and known gaps — model: sonnet 4.6
- [ ] Task: Walk §12 criterion by criterion and report unmet items honestly — model: opus 4.8

---

## 14. Answer these before Phase 2

1. **Is section 10 approved?** Guest generation means an unauthenticated endpoint that spends money
   per call. If no, v1 is login-first and the guest path is dropped.
2. **Guest quota** — is `1` free plan per device right, or should it match the current
   `MAX_TRIP_PLANS_PER_REGISTRATION` default of `3`?
3. **Distribution** — is the MCP server published to npm as `@tripdremo/mcp` (plugin uses `npx`), or
   bundled inside the plugin? This changes `.mcp.json` and the build script.
4. **Scope of the plugin** — Codex only, or Codex + Claude Code? (This document assumes both, since
   the marginal cost is one extra manifest.)
5. **Brand assets** — is there an existing Tripdremo logo/SVG and brand colour to use, or should the
   plugin ship a placeholder?
