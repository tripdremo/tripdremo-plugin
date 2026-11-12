# Troubleshooting

Print the sentence exactly, then perform the next action. Keep the error-code branch independent of the free-text tool message.

| Error code | Exact user-facing sentence | Next action |
| --- | --- | --- |
| `not_authenticated` | `Tripdremo needs an authenticated identity for this action.` | Start the login flow and re-run `tripdremo_login_wait` with a bounded timeout. |
| `login_pending` | `Tripdremo is still waiting for you to approve the sign-in.` | Re-show the returned verification link once and poll again after the returned interval. |
| `login_expired` | `The Tripdremo sign-in code has expired.` | Start a new login flow and call `tripdremo_login_wait` again with a fresh timeout. |
| `quota_exceeded` | `This Tripdremo identity has reached its plan limit.` | Report returned limit details and offer the returned login or upgrade action without inventing one. |
| `invalid_request` | `Tripdremo could not use one or more request fields.` | If `error.details.reason` is `ambiguous_submission_pending`, retry the exact unchanged plan and request; otherwise correct fields from `error.details` and retry once. |
| `generation_failed` | `Tripdremo could not generate this plan.` | Show `error.details.reason` when present and offer one retry. |
| `generation_timeout` | `Tripdremo is still generating this plan after the waiting limit.` | Return the job ID and tell the user to run a later status check. |
| `backend_ai_disabled` | `Tripdremo backend AI generation is currently disabled.` | Explain that local-first `$tripdremo` remains available; do not retry or enable it implicitly. |
| `plan_not_found` | `Tripdremo could not find a plan with that identifier.` | Ask the user to check the share hash or trip ID. |
| `rate_limited` | `Tripdremo is receiving too many requests right now.` | Wait for the returned retry interval, then retry once. |
| `backend_unreachable` | `The Tripdremo plan submission did not complete.` | For submission ambiguity or backend provider code `enrichment_unavailable`, retry the exact unchanged tool arguments so the hidden UUID is reused; if it still fails, report the retryable outage and preserve the plan for a later retry. For unrelated reads, report the configured API base URL. |
| `internal` | `Tripdremo encountered an unexpected internal error.` | Report the short incident ID from `error.details` and suggest support if the error repeats. |
