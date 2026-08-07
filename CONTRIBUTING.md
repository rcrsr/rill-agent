# Contributing to rill-agent

Thanks for your interest in the rill agent framework. This guide covers setup,
the change process, and the standards a pull request must meet before review.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Security
reports follow the [Security Policy](SECURITY.md) instead of the process below.

## Before you write code

**Open an issue first for anything non-trivial.** Bug fixes and typo corrections
can go straight to a pull request. Everything else starts as an issue so the
design gets settled before you invest in an implementation.

Use the templates under `.github/ISSUE_TEMPLATE/`. Pick the one that matches:
bug, feature, chore, security, or idea.

**Follow the agreed design.** If you find a reason to depart from it while
implementing, say so in the issue or the pull request description. An unflagged
deviation costs a review cycle and sometimes a rewrite.

**Security work follows the [Security Policy](SECURITY.md).** Report a
vulnerability in a published release privately through the
[Security tab](https://github.com/rcrsr/rill-agent/security/advisories/new), not
as a public issue.

## Setup

The framework uses Node and pnpm. The required versions live in the root
`package.json`, under `engines.node` and `packageManager`. Corepack reads the
latter and installs the right pnpm for you, so do not install pnpm globally.

```bash
corepack enable
git clone https://github.com/rcrsr/rill-agent.git
cd rill-agent
pnpm bootstrap
```

`pnpm bootstrap` verifies the toolchain, installs against the frozen lockfile,
and builds every package. `pnpm install` also runs `lefthook install`, which
registers the git hooks described below.

## Repository layout

| Package | NPM name | Role |
|---------|----------|------|
| `packages/agent/core` | `@rcrsr/rill-agent` | Manifest loader, `AgentRouter`, `validateParams` |
| `packages/agent/http` | `@rcrsr/rill-agent-http` | Hono HTTP harness |
| `packages/agent/foundry` | `@rcrsr/rill-agent-foundry` | Foundry Responses API harness |
| `packages/agent/chat` | `@rcrsr/rill-agent-chat` | OpenAI-compatible chat harness |
| `packages/agent/ahi` | `@rcrsr/rill-agent-ext-ahi` | Agent-to-agent invocation extension |
| `packages/shared/hono-kit` | `@rcrsr/rill-agent-hono-kit` *(private)* | Shared Hono lifecycle and serve glue |

## Commands

Run from the repository root:

```bash
pnpm test              # All tests, all packages
pnpm check             # Full validation: versions, build, types, lint, format,
                       # deps, custom lint rules, tests, and standards
pnpm check:types       # Type validation across every package (tsc --noEmit)
pnpm check:lint        # Lint (oxlint) only
pnpm check:format      # Formatting check (oxfmt)
pnpm check:deps        # Unused dependencies and exports (knip)
pnpm check:versions    # Every package sits at the root major.minor
pnpm check:standards   # Repository conformance (@rcrsr/rill-dev)
pnpm fix:lint          # Apply oxlint autofixes
pnpm fix:format        # Reformat with oxfmt
pnpm fix:versions      # Sync package versions to the root major.minor
```

## Git hooks

`lefthook` is installed by `prepare` on every `pnpm install`. Pre-commit formats
then lints staged files; pre-push runs typecheck and tests in parallel. Skip a
hook with `LEFTHOOK=0 git <command>` or `git <command> --no-verify` when you have
a reason.

## Linting and formatting

The repository uses **oxlint** and **oxfmt**, configured in `.oxlintrc.json` and
`.oxfmtrc.json`. These are shared across the rill ecosystem; the rule set and
severities are pinned to the reference config in `@rcrsr/rill-dev`. Do not swap
in a different linter or formatter.

## Versioning

Packages are versioned independently, but every publishable package sits at the
same `major.minor` as the root manifest, which is what a release tag matches.
`pnpm check:versions` enforces this; `pnpm fix:versions` reconciles it.
`@rcrsr/rill` peer and dev ranges match the runtime by minor. Maintainers handle
releases; do not bump versions in a feature PR unless asked.

## Before requesting review

- `pnpm check` passes locally. CI repeats it across the Node matrix.
- New tests fail when the change is reverted.
- For anything that gates, filters, or validates: the adversarial cases are
  covered, not only the happy path.
- New public API is exported from the package's `src/index.ts`. Consumers cannot
  reach deep paths.
