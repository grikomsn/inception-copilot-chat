# Sibling convention audit

Compared on September 5, 2026 against all seven existing providers in the shared workspace.

| Sibling | Shared setup checked | Provider organization |
| --- | --- | --- |
| openai-oauth-copilot-chat | Manifest metadata, npm gates, CI/release, Changesets, docs, assets | auth, commands, models, provider helpers, transport, usage |
| ollama-cloud-copilot-chat | Same, plus explicit VS Code task and opt-in host tests | Same domains, NDJSON transport and registered tools |
| grok-copilot-chat | Same; retains its own npm pin and dependency overrides | Same domains, OAuth and hosted tools |
| opencode-copilot-chat | Same | Same domains, request/message/response helpers |
| poolside-copilot-chat | Same; original API-key scaffold reference | Same domains, conversion originally inside provider.ts |
| crof-copilot-chat | Same | Same domains, request/message/response helpers |
| orvix-copilot-chat | Same; README and paired-logo layout reference | Same domains, request/message/response helpers |

Inception uses the common strict Node16/ES2023 TypeScript configuration, VS Code ^1.125.0 API, Node 22/24/26 CI matrix, npm lockfile, clean/compile/check/package gates, Changesets release workflow, issue/PR templates, MIT and community policies, development/setup/security documentation, F5 launch configuration, and black paired-logo icon/cover. Tests are colocated beside their modules. Conversion helpers live in `src/provider/`; lifecycle and model discovery remain in `src/provider.ts`.

Provider-specific features are intentionally distinct: Inception uses its documented chat-only directory and four Mercury reasoning levels. It does not copy another service's OAuth, hosted tools, billing dashboard calls, model metadata, or request fields. `.env` and the opt-in live smoke script are excluded from the VSIX; credentials are excluded from Git.

The publishing workflow consumes the repository's `VSCE_PAT` secret. Its dedicated Marketplace Manage PAT expires October 5, 2026. Rotate it in Azure DevOps and replace the Actions secret before expiration.
