# Authentication boundary

## Identity lifecycle

Every plan-submission request is authenticated. If no CLI credential exists, `tripdremo_submit_plan` automatically provisions an opaque guest CLI token without opening the browser. The guest may create exactly one successful lifetime plan for the persistent device.

For account login:

1. Call `tripdremo_login_start` with `open_browser: true`. It returns the active unexpired short code or renews the code for the persistent device.
2. Show the returned `verification_uri_complete` and `user_code` exactly once. The localized browser route is available for `en`, `lt`, `de`, and `pl`.
3. Call `tripdremo_login_wait` with a bounded timeout.
4. The browser Supabase session approves the code. The existing CLI token remains unchanged and becomes a user identity; guest-owned `Trip` and `GenerationJob` records move to the account.
5. On `approved`, report only the returned account email and claimed-plan summary.
6. On `pending`, follow the `login_pending` troubleshooting action.
7. On `expired`, follow the `login_expired` troubleshooting action.

Plan-creation policy:

- Plan creation is available before or after browser login because both guest and user CLI tokens are authenticated server identities.
- A guest may create one successful plan per persistent device. The success marker survives logout, credential expiry, revocation, and reprovisioning.
- Reprovisioning an inactive device creates a fresh guest principal and never recovers private ownership of plans belonging to the old guest principal. Locally recorded public-plan references may still be shown.
- A synchronous failure or asynchronous failure before a `Trip` exists releases the lifetime device allowance for another attempt.
- Guest generation also has a database-backed daily network budget across devices. Every accepted start counts permanently for that UTC day even if generation fails. Treat a network-budget response as `rate_limited` and follow its returned retry interval; this budget does not apply to account generation.
- Account users submitting host-model plans use the separate generous agent-local quota, configurable with a default of 50 successful stored plans.
- Account local-first enrichment has a separate durable budget of 100 accepted external-enrichment starts per UTC day. Accepted starts are not refunded after a revision or provider outage.
- Every authenticated identity is limited to 120 submission requests per hour. Raw schema, 240-location-cap, and unsafe-URL mistakes consume this request throttle but create no durable submission receipt and consume no guest/account enrichment-start budget.
- Explicit backend-AI generation uses its own smaller quota and is normally disabled. It never runs as an automatic fallback from local-first planning.
- Account generation, YAML import, shared-plan save, and CLI plan claiming share one database reservation. If one is active, follow the returned in-progress action; stale reservations expire after one hour.
- Public shared-plan reads remain anonymous.
- Backend account plan listing, save, edit, and comment actions require a user identity. A guest may see locally recorded plan references but must not be presented as having account-list access.

Logout deletes the active credential and preserves the non-secret device ID, local plan references, and server-side plans. If remote revocation fails, it stores the old token in a dormant `0600` revocation tombstone that is never an active identity. The next logout or provisioning attempt retries that revoke before guest reprovisioning; success or definitive `not_authenticated` clears the tombstone, while other failures retain it and stop reprovisioning.

The MCP server holds one opaque credential that may represent `none`, `guest`, or `user`. Never request, print, log, echo, or forward the credential, a password, a one-time password, or a Supabase token.

For an ambiguous plan submission, the MCP server stores only a `0600` hidden UUID, payload hash, identity hash, and timestamp for 24 hours. Retry the exact same request and plan to reuse the same logical submission identity. Never ask for or expose the hidden UUID, and never move pending recovery to a different credential identity.

Treat replay of an approved short code as idempotent only while the CLI session remains active. A revoked or expired session returns HTTP 410 and requires fresh provisioning or login rather than reporting the old approval.
