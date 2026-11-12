# Connect the hosted service

Endpoint: `https://mcp.tripdremo.com/mcp`. Authentication uses browser OAuth against `https://tripdremo.com`, with `trips:read` and `trips:write` scopes. Host support and account eligibility can differ; verify the actual tools, `tripdremo_auth_status` and `tripdremo_get_plan_schema` before calling the connection ready.

## ChatGPT and Claude

Use the host's custom MCP connector settings, enter the endpoint, choose OAuth authentication and complete Tripdremo browser sign-in and consent. Select the connected Tripdremo tools in this conversation, then call `tripdremo_auth_status` and `tripdremo_get_plan_schema`. Follow the current host UI rather than inventing menu names. If custom connectors are unavailable for the account, report that exact limitation and preserve the original request. Use the CLI instructions below only when that is the actual host or the user chooses that fallback; keep the same AI conversation otherwise. A browser visit to the MCP URL is not an installation test.

## Codex

Prefer the Git marketplace `tripdremo/tripdremo-plugin` and install `tripdremo-connect@tripdremo`. Restart the host if the newly installed tools are not discoverable, then use its OAuth connection action.

For a direct CLI fallback, configure the endpoint and start OAuth:

```bash
codex mcp add tripdremo-connect --url https://mcp.tripdremo.com/mcp
codex mcp login tripdremo-connect --scopes trips:read,trips:write
```

Complete browser sign-in, reopen the host if needed, then verify `tripdremo_auth_status` and `tripdremo_get_plan_schema`. If the Git marketplace profile is already active, use its connection action rather than adding a duplicate direct server. The direct server advertises the same planning and recovery instructions at initialization.

## Claude Code

Install the Git marketplace and remote profile:

```bash
claude plugin marketplace add tripdremo/tripdremo-plugin --scope user
claude plugin install tripdremo-connect@tripdremo --scope user
```

Restart Claude Code, run `/mcp`, select Tripdremo Connect and authenticate through the browser. Verify `tripdremo_auth_status` and `tripdremo_get_plan_schema`, then invoke `/tripdremo-connect:tripdremo-connect` with the original trip request.

Direct CLI fallback when the marketplace is unavailable:

```bash
claude mcp add --transport http --scope user tripdremo-connect https://mcp.tripdremo.com/mcp
```

Then use `/mcp` to authenticate and verify the account. Do not configure both the plugin and direct server for the same endpoint. Neither path depends on an unpublished npm package or a generic `npx` launcher.
