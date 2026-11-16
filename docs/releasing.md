# Releasing mods

Release Please reads Conventional Commits on `main` and opens a separate release pull request for each changed mod. `fix` changes increment the patch version, `feat` changes increment the minor version, and breaking changes follow the configured pre-1.0 policy. Changes outside a mod directory do not automatically release that mod.

Each release pull request updates the mod's `VERSION`, `CHANGELOG.md`, download link, and entry in `.release-please-manifest.json`. Merge a release pull request after its checks pass. The next Release workflow creates a tag such as `floatterm-v0.1.0` or `analytics-v0.1.0` and uploads that mod's ZIP and SHA-256 checksum. Re-running the workflow on the tagged commit restores missing assets without changing the version.

## Authentication

The preferred setup uses the shared `tedilabs/github-actions` Release Please composite action with a GitHub App, following the same pattern as the Terraform module repositories. Install the App on this repository with Contents, Issues, and Pull requests read/write permissions, then add these repository secrets:

- `RELEASE_GITHUB_APP_CLIENT_ID`
- `RELEASE_GITHUB_APP_PRIVATE_KEY`

Do not commit a private key. When both secrets exist, the workflow uses the App automatically. Its release pull requests trigger the usual CI events.

Without the App secrets, the workflow uses the repository's `GITHUB_TOKEN`. GitHub must allow Actions to create pull requests. Since this token does not trigger normal pull request workflows, the release workflow explicitly dispatches `Checks` on each created or updated release branch. Review the run for that branch before merging. Asset upload runs in the same release workflow and does not depend on a tag-triggered workflow.

## Package locally

Python 3 is required for packaging; neither installed mod needs Python.

```sh
python3 scripts/package-mod.py floatterm
python3 scripts/package-mod.py analytics
```

Archives go to `dist/`, which is ignored by Git. ZIPs include one top-level mod directory, installable code, recipe, previews, documentation, version, and license notices. They exclude personal runtime configuration, generated API types, hidden files, local data, and layouts. Fixed ZIP timestamps and permissions make identical inputs produce identical archives.

GitHub Actions and YAML validation reuse the shared workflows. Runtime tests install Node through the shared mise composite action. Keep the workflow's public dependency references distinct from private credentials and environment configuration.
