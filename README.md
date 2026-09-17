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

Requires Node ≥ 20 and pnpm 10 (`corepack enable pnpm`). `pnpm build` / `pnpm test` / `pnpm typecheck` at the root run every package in dependency order. Building or typechecking the CLI on its own also works from a fresh clone: `packages/cli` is a TypeScript project reference to `packages/sdk`, so `tsc -b` rebuilds the SDK whenever its source is newer than its `dist`; the CLI's tests read the SDK from source.

Each package publishes from its own directory (`pnpm publish` inside `packages/<name>`), SDK first: `radius-cli` depends on `radius-sdk` via `workspace:^`, which pnpm rewrites to the SDK's current version at publish time (while the SDK is 0.0.x that pins the exact version, so an SDK release needs a CLI release to follow). The CLI's `prepublishOnly` refuses to publish until that SDK version is on npm.
