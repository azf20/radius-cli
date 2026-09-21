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

Requires Node ≥ 20 and pnpm 10 (`corepack enable pnpm`). Every PR that changes `packages/cli` or `packages/sdk` adds a [changeset](.changeset/README.md) (`pnpm changeset`); a GitHub check enforces it. `pnpm version-packages` turns pending changesets into version bumps and changelogs, `pnpm release` publishes in dependency order.

Each package publishes independently from its own directory (`pnpm publish` inside `packages/<name>`).
