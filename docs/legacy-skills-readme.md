# Radius skills have moved to tools

**The canonical source is [radiustechsystems/tools](https://github.com/radiustechsystems/tools).**
This repository is retired. Its previous name, `radiustechsystems/radius-dev-skill`,
redirects here; both names refer to the same legacy repository. Use `tools`
for new installs, updates, and contributions.

The maintained skills are `radius-dev`, `dripping-faucet`, `x402`, and `sell-api`.

## Claude Code

```sh
claude plugin marketplace add radiustechsystems/tools
claude plugin install radius@tools
```

The maintained plugin is `radius` in the `tools` marketplace. Update it with:

```sh
claude plugin update radius@tools
```

If you installed this legacy repository's `radius-dev@radius-dev-skill`, remove
that old plugin and marketplace first, then run the installation commands above:

```sh
claude plugin uninstall radius-dev@radius-dev-skill --scope user
claude plugin marketplace remove radius-dev-skill --scope user
```

Use the matching scope for a project or local installation. For the previous
`radius-dev@radius-cli` installation, follow the
[plugin migration guide](https://github.com/radiustechsystems/tools/blob/main/docs/repository-migration.md#claude-plugin-name-migration).

## Codex and skills-compatible agents

Run this in your application directory:

```sh
npx skills add radiustechsystems/tools --agent codex \
  --skill radius-dev dripping-faucet x402 sell-api --copy
npx skills list --agent codex
```

Other supported agents can use `npx skills add radiustechsystems/tools` and
select their agent in the installer. Keep each skill's references and scripts
with its `SKILL.md`.

See the maintained [installation guide](https://docs.radiustech.xyz/build/coding-assistants)
and [plugin README](https://github.com/radiustechsystems/tools/tree/main/plugins/radius).

## Legacy Hermes subscribers

This repository's skills-update publisher is disabled. Its existing skill files,
commit history, and subscriber configuration are preserved for historical reads.
Existing subscribers have not been migrated to a new repository or commit.

Agents that follow this legacy source receive no further skill updates. Migrating
them requires an explicit change to their repository and commit settings; `tools`
does not automatically send replacement webhooks. The previous subscriber setup
is documented in the [historical README](https://github.com/radiustechsystems/skills/blob/0bd32d342d447855d54eb239921c1dd49a950a42/README.md).

Archiving this repository does not merge historical skills.sh installation counts.
