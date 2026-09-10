# Release SOP

How a release of this repository is cut. `/conduct:cut-release {version}`
reads this file and follows it wherever it is more specific than the skill's
defaults. Derived from the v0.18.5, v0.18.6, v0.19.0, and v0.20.0 releases.

## Scope

Every release is whole-repository. There are no per-package (qualified)
releases: `scripts/check-versions.sh` requires every package under
`packages/` to share the root `major.minor`, and `release.yml` publishes all
non-private `packages/agent/*` packages from one tag. Refuse a qualifier.

## Version source of truth

The root `package.json` `version` field. The tag must equal `v{root version}`;
`release.yml` fails the job otherwise.

| Manifest | Rule |
|---|---|
| `package.json` (root) | Set to `{version}` by hand. |
| `packages/agent/{ahi,chat,core,foundry,http}/package.json` | Same `major.minor` as root. Patch may differ. |
| `packages/shared/hono-kit/package.json` | Same rule. Private, never published, still versioned. |
| `demo/*/package.json` | Never bumped. Stay at `0.0.0`. |

Sync command, run from the repository root after editing the root version:

```bash
pnpm fix:versions      # scripts/sync-versions.sh
pnpm check:versions    # scripts/check-versions.sh, must print "All 6 workspace packages at X.Y.x"
```

`fix:versions` rewrites only packages whose `major.minor` drifted and keeps
each package's own patch. For a patch release (`0.21.0` to `0.21.1`) it
changes nothing, so set every package's patch by hand to `{version}` in that
case. A package that had no changes still gets bumped; the whole set ships at
one version (v0.19.0 precedent: core shipped with "no source changes").

## `@rcrsr/rill` minor lockstep

`@rcrsr/rill-agent-ext-ahi` declares `@rcrsr/rill` as a `~X.Y.0` peer and dev
dependency. When rill releases a new minor, this repository bumps to the same
`major.minor` and updates both ranges. The rill dependency bump lands in a
normal PR before the release PR; the release PR only stamps. Verify before
cutting:

```bash
grep '"@rcrsr/rill"' packages/agent/ahi/package.json   # both lines ~{major.minor}.0
```

## Changelogs

Six files, all Keep a Changelog 1.1.0, bracketed headings, no link-reference
block at the bottom:

- `CHANGELOG.md` (root, framework-wide narrative)
- `packages/agent/{ahi,chat,core,foundry,http}/CHANGELOG.md`

`packages/shared/hono-kit` and `demo/*` have no changelog.

For each file:

1. Rename `## [Unreleased]` to `## [{version}] - {YYYY-MM-DD}`.
2. Insert an empty `## [Unreleased]` above it.
3. If the package's Unreleased section is empty, still stamp it with one
   entry under `### Changed`:
   `- Version bumped to align with framework-wide {version} release (no source changes)`
   Never leave a published package without a heading for its shipped version.

The root changelog's Unreleased section must have at least one entry. An empty
root section means there is nothing to release.

## Branch, commit, PR, tag

| Item | Value |
|---|---|
| Branch | `release/{version}` |
| Commit | `chore(release): {version}` |
| PR title | `Release {version}` |
| Merge | Squash, subject `chore(release): {version} (#{pr})` |
| Tag | `v{version}`, annotated, message `Release {version}`, on the squash commit on `main` |

The release PR contains only version bumps and changelog stamps. Dependency
sweeps, standards adoption, and bug fixes land in their own PRs first (v0.20.0
precedent: PR #24 was six one-line changelog edits after #15 through #23 had
merged). If `git status` after the bump shows anything beyond the 7 manifests
and 6 changelogs, stop and land that work separately.

Pre-flight before opening the PR, from the repository root:

```bash
pnpm check            # versions, build, types, lint, format, knip, rules, tests, standards
```

The pre-push hook runs typecheck and tests, and CI runs `pnpm check` on Node
22, 24, and 25. Branch protection requires the three `check (N)` contexts.

## What the tag triggers

Pushing `v*` runs `.github/workflows/release.yml`, which:

1. Verifies `check:versions` and that the tag equals the root version.
2. Builds and tests.
3. Publishes each non-private `packages/agent/*` package to npm with
   provenance, skipping versions already on the registry. Needs the
   `NPM_TOKEN` secret.
4. Creates the GitHub Release with `--generate-notes`.

Because the workflow creates the release, **do not run `gh release create`**
after pushing the tag. Optionally replace the generated notes afterwards with
the PR narrative:

```bash
gh release edit v{version} --notes-file notes.md
```

The concurrency group is fixed and never cancels. A re-push of the same tag
after a partial publish is safe: already-published versions are skipped by the
`npm view` check and by the `EPUBLISHCONFLICT` match.

## Post-release

- Confirm all five packages resolve on npm at `{version}`:
  `for p in rill-agent rill-agent-http rill-agent-foundry rill-agent-ext-ahi rill-agent-chat; do npm view @rcrsr/$p version; done`
- Confirm the GitHub Release exists: `gh release view v{version}`.
- Delete the release branch once merged; `main` carries the tag.

## Do not

- Bump `demo/*` manifests.
- Add `@rcrsr/rill` range changes to the release PR.
- Publish by hand with `pnpm publish`; provenance only comes from CI.
- Run `pnpm check:standards --remote` in CI. It is a maintainer step.
- Create a GitHub Release by hand before `release.yml` has run on the tag.
