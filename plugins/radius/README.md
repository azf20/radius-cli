# Radius development plugin

The `radius-dev` Claude Code plugin provides four skills:

- `radius-dev` for Radius Network application development
- `x402` for paying x402 endpoints (agents, terminals, app buyers) and the protocol
- `sell-api` for charging for an API: framework detection, `radius-sdk` seller
  setup, and verification with `radius-cli sell check`
- `dripping-faucet` for testnet faucet workflows

The SDK examples target `radius-sdk` 0.3.0 or later (`sell-api` targets 0.5.0
or later, for MPP and several networks), and terminal wallet examples target
`radius-cli` 0.4.0 or later (`wallet pay`); `radius-cli sell check` needs
`radius-cli` 0.5.0. Install the peer dependency needed by the SDK entry point
you use (`viem` for `/client`, `hono` for `/hono`).

The `evals/` directory holds the Claude Code plugin eval cases. The
`sell-oneshot` case shares its prompt with the repository's deterministic
seller evaluation (`pnpm eval:payments:sell -- --case SELL-ONESHOT`), which
boots the app an agent writes and pays it against a mock facilitator.

Install it from the [Radius CLI repository](https://github.com/radiustechsystems/radius-cli):

```sh
claude plugin marketplace add radiustechsystems/radius-cli
claude plugin install radius-dev@radius-cli
```

After a new plugin version is published, update an existing installation with
`claude plugin update radius-dev@radius-cli`. Automatic updates depend on the
user's marketplace setting.

The plugin is versioned independently from the `radius-cli` and `radius-sdk`
npm packages. Its version is in `.claude-plugin/plugin.json`; the GitHub
marketplace lists the plugin at `.claude-plugin/marketplace.json` in the
repository root. See the [repository release instructions](https://github.com/radiustechsystems/radius-cli#agent-skills)
for validation and compatibility rules.

This plugin is distributed under the repository's [MIT license](https://github.com/radiustechsystems/radius-cli/blob/main/LICENSE).
