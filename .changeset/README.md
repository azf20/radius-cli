# Changesets

Every pull request that changes a publishable package (`packages/cli`, `packages/sdk`) adds a
changeset: `pnpm changeset`, pick the package(s), pick patch / minor / major, write the one-line
entry that will appear in the changelog. The `changeset` GitHub check refuses PRs that change a
package without one; add the `no changeset` label for changes that need no release note.

`packages/docs` is private and unversioned: docs-only PRs need no changeset. Its production deploys follow npm
releases (see `packages/docs/README.md`).

The Claude plugin under `plugins/radius` is released separately. Skill and plugin changes do not
need a changeset unless the same PR also changes a publishable package. Bump the plugin version in
`plugins/radius/.claude-plugin/plugin.json` for release content changes; plugin CI enforces this.
If the skill needs a new CLI or SDK API, publish the npm package first, then release the plugin
guidance with the minimum supported package version.

Releasing is automated by `.github/workflows/release.yml`. Merging changesets to `main` opens (or
refreshes) a **Version Packages** PR on the `changeset-release/main` branch: it runs `pnpm
version-packages` (bumps versions, writes CHANGELOG.md files, bumps `radius-cli` whenever `radius-sdk`
moves). Merging that PR publishes the bumped packages to npm through Trusted Publishing (no npm token),
pushes a `<name>@<version>` git tag for each, and creates a GitHub Release. The examples are private and
never versioned.

If publishing fails, correct the cause and re-run the failed jobs in the existing Release workflow.
Use its npm Trusted Publishing connection rather than a local publish or an npm token. A failure
after successful publication needs only the failed follow-up work; do not bump versions to retry
docs deployment. See the root README and [repository migration checks](../docs/repository-migration.md).
