# Changesets

Every pull request that changes a publishable package (`packages/cli`, `packages/sdk`) adds a
changeset: `pnpm changeset`, pick the package(s), pick patch / minor / major, write the one-line
entry that will appear in the changelog. The `changeset` GitHub check refuses PRs that change a
package without one; add the `no changeset` label for changes that need no release note.

Releasing: `pnpm version-packages` applies the pending changesets (bumps versions, writes
CHANGELOG.md files, bumps `radius-cli` whenever `radius-sdk` moves), then `pnpm release` builds and
publishes in dependency order (SDK before CLI). The examples are private and never versioned.
