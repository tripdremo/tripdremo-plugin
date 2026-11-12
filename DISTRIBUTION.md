# Tripdremo plugin distribution

Version 0.2.1 updates Claude Code connector setup guidance and synchronizes package versions for normal client upgrades. Its generated artifacts remain local until published. Native Codex OAuth and save passed with the 0.2.0 profile; other native save checks remain pending. See [REMOTE.md](REMOTE.md).

## Current channels

| Channel | Status | Install source |
| --- | --- | --- |
| Codex Git marketplace | Published | `tripdremo/tripdremo-plugin` |
| Claude Code Git marketplace | Published | `tripdremo/tripdremo-plugin` |
| OpenAI public plugin directory | Not submitted or approved | Requires OpenAI partner allowlisting for a public local-stdio plugin |
| Claude plugin directory | Not submitted or approved | Requires an eligible paid Claude account and connected GitHub access |
| Claude official marketplace | Not submitted or approved | Partner-managed publication path |

The repository marketplace is public distribution: users can add it directly from GitHub without waiting for directory listing. Directory badges or approval claims require a confirmed listing from the provider.

## Release checklist

1. Keep root/MCP package versions and all local/remote manifests at the same version:
   - `plugin/.codex-plugin/plugin.json`
   - `plugin/.claude-plugin/plugin.json`
   - `plugin-connect/.codex-plugin/plugin.json`
   - `plugin-connect/.claude-plugin/plugin.json`
2. Run `npm run build`, `npm test`, and `npm run lint`.
3. Run `claude plugin validate --strict .` and validate both generated `tripdremo-claude` and `tripdremo-connect-claude` packages.
4. With the local Trips stack running, execute `npm run smoke:local -- /absolute/path/to/plan-submission.json`.
5. Commit the canonical sources and generated marketplace artifacts together, then push the public repository.
6. Test a clean install from `tripdremo/tripdremo-plugin` in both hosts.
7. Verify the onboarding and brief URLs:
   - `https://tripdremo.com/en/connect-ai`
   - `https://tripdremo.com/ai/trip-planning-brief.txt`

## Directory submission checklist

### OpenAI

- Confirm the Tripdremo organization is approved for public local-stdio plugin submission.
- Use the public GitHub repository and the packaged MCP; do not substitute an unpublished npm package.
- Submit the exact permissions and data behavior documented in the skill and README.
- Record the provider review URL or approval response before changing the status above.

Reference: [OpenAI desktop-only plugin deployment](https://developers.openai.com/plugins/deploy/desktop-only).

### Claude

- Sign in to an eligible paid Claude account and connect the GitHub account with push access to `tripdremo/tripdremo-plugin`.
- Submit through the [Claude directory manager](https://claude.ai/directory/manage).
- Keep the repository public before go-live and validate the submitted commit with `claude plugin validate --strict`.
- Record the directory listing URL before changing the status above.

References: [Claude directory submission](https://claude.com/docs/plugins/submit) and [Claude plugin publishing](https://code.claude.com/docs/en/plugins/publish).
