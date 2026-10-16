# Repository migration checks

The implementation source for the SDK, CLI, docs and current Radius skills is
[`radiustechsystems/tools`](https://github.com/radiustechsystems/tools).
The npm package names remain `radius-sdk` and `radius-cli`. Claude retains the
installed identity `radius-dev@radius-cli`: `radius-dev` is the plugin name and
`radius-cli` is the marketplace name, independent of the repository slug.

## Skill installation and public references

The plugin currently includes four skills: `radius-dev`, `dripping-faucet`,
`x402`, and `sell-api`. Keep their `references/` and `scripts/` directories with
each installed `SKILL.md`. The expanded `/skills/*.md` files are reading
references, not a replacement for installing those supporting files.

Validate a checkout without changing an existing Claude installation:

```sh
python3 scripts/validate_plugin.py
claude plugin validate plugins/radius --strict
claude plugin validate . --strict
(
  export CLAUDE_CONFIG_DIR="$(mktemp -d)"
  claude plugin marketplace add "$PWD"
  claude plugin install radius-dev@radius-cli
  claude plugin list --json
)
```

For Codex, run the following from a disposable project directory, using the
absolute path to this checkout. This exercises discovery and copies all four
skills, including supporting files, into that project's `.agents/skills`.

```sh
npx --yes skills@1.7.2 add /absolute/path/to/tools --list
npx --yes skills@1.7.2 add /absolute/path/to/tools \
  --agent codex --skill radius-dev dripping-faucet x402 sell-api --copy --yes
npx --yes skills@1.7.2 list --agent codex
```

Codex's [skill discovery documentation](https://learn.chatgpt.com/docs/build-skills)
describes the project and user skill directories. Start a new conversation
after installation to check discovery in the agent itself.

`pnpm --filter radius-docs test:skills` generates all four public references and
checks their descriptions, plugin version, repository metadata, and links.
`pnpm --filter radius-docs build` copies them into `dist/public/skills`.
After deploying docs, fetch each `/skills/<name>.md` from
`https://docs.radiustech.xyz` and verify its version and `tools` source links.
A successful local build does not establish that the new files are live.

## npm Trusted Publishing after a rename

For **both** packages on npmjs.com, the GitHub Actions publisher must allow
organization `radiustechsystems`, repository `tools`, workflow `release.yml`.
The environment is blank unless the publish job explicitly selects one.
Allow direct `npm publish`, as used by the existing Changesets workflow.
Do not add an npm token as a rename workaround.

According to [npm's publisher configuration documentation](https://docs.npmjs.com/trusted-publishers/),
required fields on an existing connection cannot be edited; changing them
requires recreating the connection. New connections must publish successfully
within two days. Package `repository.url` must match the GitHub repository:
`git+https://github.com/radiustechsystems/tools.git`, with `repository.directory`
set to `packages/sdk` or `packages/cli`.

Before releasing, run `pnpm build`, `pnpm typecheck`, and `pnpm test`. Pack both
packages with `pnpm --filter radius-sdk pack --pack-destination <temp-dir>` and
the corresponding CLI command. Inspect `package/package.json` in each tarball:
the repository URL and directory must be correct, and the CLI dependency must
resolve to `^<current SDK version>` rather than `workspace:^`. Confirm the
tarballs contain the declared exports and executable CLI entry point.

The existing workflow builds/tests/packs, publishes the SDK before its CLI
dependent, creates package tags and GitHub Releases, then calls Deploy docs.
Only the publish job receives `id-token: write`. Preserve this ordering.

## Verified post-rename release, October 16, 2026

The October 15 [Release run, attempt 5](https://github.com/radiustechsystems/tools/actions/runs/38782878671/attempts/5)
successfully published `radius-sdk@0.6.0` and `radius-cli@0.5.0` from commit
`520bbc6c92ffec6956947673692f1b67964f3f8f`.

- Registry metadata for [SDK 0.6.0](https://registry.npmjs.org/radius-sdk/0.6.0)
  and [CLI 0.5.0](https://registry.npmjs.org/radius-cli/0.5.0) names `tools` and
  the correct package directories. The CLI depends on `radius-sdk:^0.6.0`.
- The [SDK provenance statement](https://registry.npmjs.org/-/npm/v1/attestations/radius-sdk@0.6.0)
  and [CLI provenance statement](https://registry.npmjs.org/-/npm/v1/attestations/radius-cli@0.5.0)
  identify `tools`, `.github/workflows/release.yml`, the same commit, and attempt 5.
- The [SDK release](https://github.com/radiustechsystems/tools/releases/tag/radius-sdk%400.6.0)
  and [CLI release](https://github.com/radiustechsystems/tools/releases/tag/radius-cli%400.5.0)
  exist, and both package tags resolve to that commit.
- The subsequent docs deployment failed. `docs-live` was absent when checked.
  The [next Release run](https://github.com/radiustechsystems/tools/actions/runs/38793955467)
  succeeded with publish and deploy skipped: it does not prove docs recovery.

This establishes a real post-rename package publish and inspected provenance
records, rather than a dry run. It does not establish current npm console
settings or successful docs deployment. Recover docs through Deploy docs on a
ref with no pending package changesets, then verify `docs-live` and public URLs.

## Legacy skill repository

On October 16, GitHub resolved both `radiustechsystems/radius-dev-skill` and
`radiustechsystems/skills` to the same unarchived repository,
`radiustechsystems/skills`. They are not two repositories that can be archived
independently. The legacy repository also has an enabled publisher with four
Hermes subscribers; a push can send update webhooks.

ENG-2448's October 14 instruction to keep `skills` canonical while archiving
`radius-dev-skill` therefore needs a revised disposition. Do not archive the
redirect target or send subscriber updates as part of an install-link fix.
Record the canonical-source decision and subscriber handoff in Linear before
retiring that repository. Historical skills.sh counts are separate from the
GitHub redirect; do not claim that a redirect merges installation statistics.
