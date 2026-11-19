# CI on Forgejo

Paseo's CI runs as Forgejo Actions in `.forgejo/workflows/`. GitHub Actions in
`.github/workflows/` were removed. The Forgejo repo `callmeteus/paseo` is a
read-only pull mirror of the GitHub repo, so GitHub remains the source of truth
for code; Forgejo runs the checks and releases.

## Triggers

Forgejo Actions does not fire reliably on mirror sync. Workflows are started by:

- `gitops-webhook` (in `techtail/gti-infra`) dispatching them through the
  Forgejo API when GitHub receives a push;
- a manual `workflow_dispatch` in the Forgejo UI;
- `nightly.yml`, which uses a `schedule` cron and always checks out `develop`.

`merge_group` and required status checks are GitHub-only and have no Forgejo
equivalent. Do not reintroduce them.

## Secrets

These Forgejo repo secrets are required:

| Secret                  | Used for                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| `GH_TOKEN`              | GitHub release creation, asset upload, GHCR login, package registry |
| `CLOUDFLARE_API_TOKEN`  | Web/website/relay deploys                                           |
| `CLOUDFLARE_ACCOUNT_ID` | Web/website/relay deploys                                           |

`GH_TOKEN` replaces the implicit `secrets.GITHUB_TOKEN`: Forgejo does not issue
a GitHub token. Scripts such as `scripts/github-release.mjs` read it from the
environment through the `gh` CLI.

## Runner

Workflows use `runs-on: docker`, the `gti-actions:latest` image. It is Linux
only, so the Forgejo workflows do not build macOS or Windows desktop packages.
They need signed native runners and stay out of scope here. APK jobs use a
`mingc/android-build-box` container for the Android SDK and Gradle.

## Nightly

`.forgejo/workflows/nightly.yml` runs daily at 02:00 UTC and can be dispatched
manually. It builds the Linux desktop packages, builds an Android APK with
`npm run build:apk:arm64` inside an Android container, then deletes and recreates
the `nightly` GitHub release with the latest artifacts. The release is marked
prerelease and is not a stable channel.

## Change gating

`scripts/forgejo-ci-paths.mjs` computes the same contract outputs that
`dorny/paths-filter` produced on GitHub, using `git diff` against
`origin/develop`. The contract definitions remain in `.github/ci-paths.yml`.

## Validation

`node --test scripts/ci-workflow.test.mjs` checks that every Forgejo workflow
is dispatchable, uses the Linux runner, keeps GitHub Releases on `GH_TOKEN`,
and that the nightly still builds both targets.
