# Repository migration checks

The canonical source for the SDK, CLI, docs and Radius skill installs is
[`radiustechsystems/tools`](https://github.com/radiustechsystems/tools).
The npm package names remain `radius-sdk` and `radius-cli`. The Claude plugin is
`radius` in the `tools` marketplace, installed as `radius@tools`. Plugin 0.2.0
replaces the old `radius-dev@radius-cli` identity.

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
  claude plugin install radius@tools
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

## Claude plugin name migration

After plugin 0.2.0 is merged and available from the marketplace, users with the
old user-scoped installation run:

```sh
claude plugin uninstall radius-dev@radius-cli --scope user
claude plugin marketplace remove radius-cli --scope user
claude plugin marketplace add radiustechsystems/tools --scope user
claude plugin install radius@tools --scope user
claude plugin list --json
```

For the older `skills` marketplace, the first two commands instead use
`radius-dev@radius-dev-skill` and `radius-dev-skill`. Run only the removal
commands matching an installed source, then add `tools` and install `radius@tools`.

Use the matching `project` or `local` scope for installations made at those
scopes. Marketplace removal affects its installed plugins; the old Radius
marketplaces each contain only the Radius plugin. Review checked-in
`extraKnownMarketplaces` and `enabledPlugins` settings for old identities, and
update managed declarations through their administrator.

The new identity is a replacement, not an automatic compatibility alias.
Individual skill IDs (`radius-dev`, `dripping-faucet`, `x402`, `sell-api`) remain
the same. Namespaced Claude commands change from `/radius-dev:<skill>` to
`/radius:<skill>`. Codex/skills installation is unaffected.

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

At the start of the October 16 review, GitHub resolved both `radiustechsystems/radius-dev-skill` and
`radiustechsystems/skills` to the same unarchived repository,
`radiustechsystems/skills`. They are not two repositories that can be archived
independently. The legacy repository then had an enabled publisher with four
Hermes subscribers, so a push could send update webhooks.

Eriks confirmed on October 16 that **`tools` is canonical**, superseding the
October 14 source decision in ENG-2448. Retire the single legacy repository:
disable its publisher, check for queued or running deliveries, replace its
README with the [migration notice](legacy-skills-readme.md), then archive it.
Do not create a second distribution copy of the current skills there.

The publisher is now `disabled_manually`, with no queued or running deliveries.
GitHub rejected the README update with HTTP 409: **"Changes must be made through
a pull request."** The notice is prepared here, but the default-branch README
has not changed and the repository has not been archived. Landing the notice
requires a README-only administrative PR in the legacy repository; this is
separate from the single implementation PR in `tools`.

Preserve the old skill files, history, and subscriber configuration. Existing
agents can still fetch historical content, but the retired publisher sends no
new updates. Subscriber migration is separate: do not silently change their
repository/commit settings or recreate webhooks in `tools`.

Verify both legacy repository URLs resolve to the archived repository and
historical raw skill files remain readable. Historical skills.sh counts are
separate from the GitHub redirect; retirement does not merge installation
statistics. Use `radiustechsystems/tools` for new installs and continue tracking
historical legacy counts separately until the KPI workflow is migrated.
