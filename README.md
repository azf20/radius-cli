# radius

Tools for the [Radius Network](https://radiustech.xyz), managed as one pnpm workspace.

| Package | What |
| --- | --- |
| [`packages/cli`](./packages/cli) | `radius-cli` — CLI wallet for Radius, modeled on Foundry's `cast` |
| [`packages/sdk`](./packages/sdk) | `radius-sdk` — accept and make Radius payments over x402 v2 (Hono / Cloudflare Workers first) |

## Development

```bash
pnpm install                          # installs every workspace package
pnpm build                            # builds every package
pnpm test                             # runs every package's tests
pnpm --filter radius-cli build        # one package
node packages/cli/dist/index.js --help
```

Requires Node ≥ 20 and pnpm 10 (`corepack enable pnpm`). Each package publishes independently from its own directory (`pnpm publish` inside `packages/<name>`).
