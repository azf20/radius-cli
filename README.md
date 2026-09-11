# radius

Tools for the [Radius Network](https://radiustech.xyz), managed as one npm workspace.

| Package | What |
| --- | --- |
| [`packages/cli`](./packages/cli) | `radius-cli` — CLI wallet for Radius, modeled on Foundry's `cast` |

## Development

```bash
npm install                    # installs every workspace
npm run build                  # builds every workspace
npm test                       # runs every workspace's tests
npm run build -w packages/cli  # one workspace
node packages/cli/dist/index.js --help
```

Each package publishes independently from its own directory (`npm publish` inside `packages/<name>`).
