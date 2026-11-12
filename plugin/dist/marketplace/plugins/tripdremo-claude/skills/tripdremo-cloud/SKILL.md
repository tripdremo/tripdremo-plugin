---
name: tripdremo-cloud
description: Generate a trip with Tripdremo backend AI as an explicit, higher-cost compatibility path. Use only when the user explicitly requests Tripdremo cloud or backend AI generation; never select it as a silent fallback from local-first planning.
disable-model-invocation: true
---

# Tripdremo Cloud

Use the preserved Tripdremo backend-AI generator only after the user explicitly chooses this mode. Backend AI is more expensive than the default host-model flow and is normally disabled with `TRIPDREMO_AGENT_BACKEND_AI_ENABLED=0`.

## Generate with backend AI

1. Preserve the user's complete planning request and resolve concrete dates, travelers, style, and budget. Include at most 12 children.
2. Call `tripdremo_create_plan` with `wait_seconds: 60`. Let it provision the authenticated guest identity when needed; do not request a password, one-time password, Supabase token, or CLI token.
3. If it returns `generating`, poll `tripdremo_plan_status` at `poll_after_seconds`, report only changed progress, and stop after about five minutes.
4. Render only values returned by the tools: title, inclusive dates, day summaries, and absolute share URL.

If the tool returns `backend_ai_disabled`, state that backend AI is disabled and direct the user to the default local-first `$tripdremo` skill. Do not enable the environment variable, retry, or invoke the local-first skill without telling the user. Never present this skill as an automatic quality fallback for weak or old host models.

Use the default `$tripdremo` skill for login, logout, identity status, plan listing, public-plan retrieval, and normal planning.
