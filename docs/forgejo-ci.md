# CI on Forgejo

Paseo's CI runs as Forgejo Actions in `.forgejo/workflows/`. GitHub Actions in
`.github/workflows/` were removed. The Forgejo repo `callmeteus/paseo` is a
read-only pull mirror of the GitHub repo, so GitHub remains the source of truth
for code; Forgejo runs the checks and releases.

## Triggers

Forgejo Actions does not fire reliably on mirror sync. Workflows are started by:

- `gitops-webhook` (in `techtail/infra`) dispatching them through the
  Forgejo API when GitHub receives a push;
- a manual `workflow_dispatch` in the Forgejo UI;
- `nightly.yml`, which uses a `schedule` cron and always checks out `develop`.

`merge_group` and required status checks are GitHub-only and have no Forgejo
equivalent. Do not reintroduce them.

## Secrets

These Forgejo repo secrets are required:

| Secret                   | Used for                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `GTI_CI_APP_ID`          | GitHub App ID (`gti-ci`, stored in Vault `secret/infra/gti-ci`) |
| `GTI_CI_APP_PRIVATE_KEY` | GitHub App private key (same Vault path)                        |
| `CLOUDFLARE_API_TOKEN`   | Web/website/relay deploys                                       |
| `CLOUDFLARE_ACCOUNT_ID`  | Web/website/relay deploys                                       |

Each job that talks to GitHub starts with `actions/create-github-app-token`,
which exchanges the two App secrets for a short-lived installation token. The
token is exposed as `GH_TOKEN` to the step that runs `gh` or publishes to GHCR.
Forgejo does not issue an implicit `secrets.GITHUB_TOKEN`. The App must be
installed on `callmeteus/paseo` with Contents read/write, Packages read/write,
and Metadata read-only.

## Runner

Workflows use `runs-on: docker`, the `gti-actions:latest` image, which already
provides Node. Do not use `actions/setup-node` in these workflows: it installs
Node under `/opt/hostedtoolcache` on the runner host, while action steps execute
inside a container that cannot see that path, so every subsequent Node-based
step fails with `node: no such file or directory`. The Forgejo runner is Linux
only, so it does not build macOS or Windows desktop packages. APK jobs use a
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
