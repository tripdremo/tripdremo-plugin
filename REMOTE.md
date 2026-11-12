# Hosted Tripdremo Connect

Version 0.2.1 corrects the Claude Code OAuth setup instructions for the account-only Streamable HTTP service and `tripdremo-connect` Git marketplace profile introduced in 0.2.0. The existing `tripdremo` profile still launches the bundled stdio server and retains its local guest/device workflow.

The canonical endpoint is `https://mcp.tripdremo.com/mcp`. The OAuth issuer is `https://tripdremo.com`; it serves authorization-server metadata, registration, browser authorization, token exchange and revocation. MCP serves JSON protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-protected-resource`. Unauthenticated MCP requests include a `WWW-Authenticate` metadata challenge.

## Release status

The hosted service is deployed. The 0.2.1 package update is prepared for publication; its change is connector setup guidance and synchronized release metadata. Local transport and packaging checks are separate from production acceptance. A public DNS response, a marketplace package, or a successful unauthenticated metadata request does not prove a real ChatGPT or Claude account can authorize and save a plan. Record completed host acceptance below before calling a host supported in production.

| Host acceptance | State |
| --- | --- |
| ChatGPT custom connector + OAuth + saved plan | Not yet verified on a real account |
| Claude connector + OAuth + saved plan | Not yet verified on a real account |
| Codex Git remote profile + OAuth + saved plan | Verified with the 0.2.0 profile on 2026-11-12; returned share hash `FtaokzIJ` |
| Claude Code Git remote profile + OAuth + saved plan | Not yet verified against the hosted deployment |

Provider-directory publication is tracked in [DISTRIBUTION.md](DISTRIBUTION.md). Installing from the Git marketplace is independent of provider-directory approval.

## Install and authorize

ChatGPT and Claude users with custom connector access can add `https://mcp.tripdremo.com/mcp`, select OAuth, sign in on Tripdremo and grant consent. Return to the chat, select the integration, and verify `tripdremo_auth_status` reports the intended account and `tripdremo_get_plan_schema` succeeds. Account eligibility and UI placement must be checked in the actual host; no directory listing or universal account availability is implied.

Codex Git marketplace:

```bash
codex plugin marketplace add tripdremo/tripdremo-plugin
codex plugin add tripdremo-connect@tripdremo --json
```

Claude Code Git marketplace:

```bash
claude plugin marketplace add tripdremo/tripdremo-plugin --scope user
claude plugin install tripdremo-connect@tripdremo --scope user
```

For the installed Claude Code plugin, run this from an interactive terminal:

```bash
claude mcp login 'plugin:tripdremo-connect:tripdremo-connect'
```

The plugin's scoped server name is required. If an agent's terminal has no TTY, use `/mcp` in an interactive Claude Code session, select the Tripdremo Connect plugin server and choose Authenticate. `--no-browser` still requires an interactive terminal; it is not a non-interactive workaround. Complete browser sign-in, then verify the account and live schema before planning or writing. Restart the host if needed to discover its tools. The remote skill is `tripdremo-connect` (Claude Code: `/tripdremo-connect:tripdremo-connect`). Install `tripdremo@tripdremo` instead to keep using the local stdio/guest profile.

Tripdremo MCP OAuth is separate from Claude model sign-in and account eligibility. A completed connector login alone does not prove that Claude Code can run a model or complete an itinerary save; native save acceptance remains pending until exercised.

If marketplace installation is unavailable, use a direct remote CLI configuration. Choose one installation method for each host:

```bash
codex mcp add tripdremo-connect --url https://mcp.tripdremo.com/mcp
codex mcp login tripdremo-connect --scopes trips:read,trips:write
```

```bash
claude mcp add --transport http --scope user tripdremo-connect https://mcp.tripdremo.com/mcp
claude mcp login tripdremo-connect
```

For the manually registered Claude Code server, use the unprefixed `tripdremo-connect` name shown above and an interactive terminal. If the agent has no TTY, use that server's Authenticate action in the interactive `/mcp` panel. Complete browser authentication and verify both `tripdremo_auth_status` and `tripdremo_get_plan_schema`. No npm publication, `npx` package or manual token copying is involved. The server supplies workflow instructions at MCP initialization, including for direct installations.

## Service deployment

`Dockerfile` and `captain-definition` build the HTTP entrypoint with Node 22. Deploy to the existing CapRover app `mcp`, with container port 3000 and HTTPS for `mcp.tripdremo.com`. Container builds run on CapRover; local Docker Desktop is not part of the workflow. Required configuration is documented in [.env.remote.example](.env.remote.example).

Set `TRIPDREMO_MCP_GATEWAY_SECRET` to the same high-entropy secret as the backend, using the platform's secret environment configuration. The service refuses to start with an absent/short value. Do not commit it, send it to a client or place it in a plugin manifest.

The production backend is restricted to the private CapRover service `http://srv-captain--tripdremo-api-be:8000/api/v1`. For a local integration check, set `TRIPDREMO_REMOTE_BACKEND_URL=http://127.0.0.1:8000/api/v1` and allow the exact local authority through `TRIPDREMO_MCP_ALLOWED_HOSTS`, such as `127.0.0.1:3000`. Only that private service and loopback backend overrides are allowed. The public OAuth audience and metadata remain canonical even in local checks. Start the service with `npm run build` then `npm run start:remote`.

Host and Origin checks use exact allowlists. The service ignores forwarded headers for security decisions. Configure proxies to preserve `Host: mcp.tripdremo.com`. Requests without Origin are permitted for native clients; browser origins must be explicitly allowed. `/health` returns JSON and checks Host/Origin like other routes. The container healthcheck sends the canonical Host header.

Each HTTP request gets a fresh MCP server and delegated backend client. No MCP session IDs, shared guest credential, `~/.tripdremo` state, browser cookies or global user cache are used. Every request introspects its bearer token through `/oauth/internal/token-check/` with the gateway header. An active token must have the exact MCP audience, a numeric future UNIX expiry, a subject/client ID and the tool's scope. Read tools require `trips:read`; prepare/submit require `trips:write`. The bearer and gateway headers are forwarded only to fixed `/mcp/` backend adapters. Redirects are rejected; upstream timeouts fail closed.

## Save and recover

The seven tools are authentication status, schema, prepare submission, submit plan, submission status, get plan and list plans. The current conversation AI authors the plan. Remote tools do not offer guest provisioning, local login/logout or cloud itinerary generation.

Prepare reserves a backend UUID before submission. Retrying the same payload reuses that UUID. A structured revision uses a newly prepared UUID. Recover an ambiguous result by UUID, or list up to 20 account operations after reconnecting: unresolved operations, including expired unknown outcomes, come before recent completed operations. The backend owns durable receipts, leases, payload conflicts and account isolation. Hosted MCP maps ready responses to the same compact plan projection as stdio and preserves the status/revision recovery metadata.

## Acceptance sequence

1. Build and run local HTTP tests plus isolated profile validation: `npm run build`, `npm test`, `npm run lint`.
2. Validate both generated Claude packages and the repository marketplace with `claude plugin validate --strict`.
3. Build the container on CapRover and run `/health`, canonical JSON metadata and unauthenticated 401 discovery checks.
4. After approved deployment, use two real accounts to authorize, save, retrieve and list only their own account data. Test token revocation and wrong scopes.
5. Interrupt a save after dispatch, reconnect, recover its receipt and replay the unchanged UUID without creating a duplicate. Repair a structured revision with a fresh prepared UUID.
6. Record host, account eligibility, release commit, timestamps and observed result URLs. Keep any untested host explicitly pending.

## Local validation evidence (2026-11-12)

- `npm run build`, `npm test` and `npm run lint` pass: 116 tests plus isolated local Codex/Claude handshakes and remote-package checks.
- HTTP tests cover metadata/discovery, Host/Origin rejection, two-user isolation, exact audience and numeric expiry, read/write scopes, revoked credentials, timeout recovery, UUID replay forwarding, revisions, account plan projection and hostile JSON inputs.
- SDK 1.32.0 and Zod 4.6.6 are pinned to patched releases. Compatible transitive updates reduce `npm audit --omit=dev` to zero reported vulnerabilities. The SDK documents that its validation fix also requires explicit input bounds; this service enforces a 2 MiB body limit, 20,000 JSON elements and depth 64 before SDK validation. See the [SDK advisory](https://github.com/advisories/GHSA-46jr-4wx8-v453) and [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
- The repository marketplace and both generated Claude packages pass strict validation. Skill validation passes. The hosted runtime's dependency graph excludes local credential storage and the local API client.
- No local container-build success is claimed. Deployment was performed separately by the release coordinator. Native Codex OAuth and save passed with the 0.2.0 profile; ChatGPT, Claude Web and Claude Code native save acceptance remain pending. Publishing and upgrading the 0.2.1 package is a separate release step.
