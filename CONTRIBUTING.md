# Contributing

Small, focused contributions are welcome. Keep Floatterm and Analytics independently installable, preserve existing user configuration, and document changes to visible behavior in the mod's README and RECIPE.

## Run the checks

Use Node ≥22.15. There are no packages to install:

```sh
npm test
npm run check:package
```

The tests cover session scopes, focus races, fuzzy search, aggregation, account isolation, quota parsing, retry handling, and UI event handlers. They use fixtures, not your credentials. CI runs them on Node 22 and 24.

On macOS with Herdr running, also run:

```sh
herdr-app check floatterm/mods/floatterm
herdr-app check analytics/mods/analytics
```

Native checks only validate initial rendering. Before submitting UI changes, test in your running Herdr setup with a backup of the affected mod. Exercise open/close, navigation, and asynchronous states. Do not launch a second Herdr process with another app home to test against a shared core.

## Distribution contract

Each top-level mod folder contains `RECIPE.md`, `preview.png`, an optional `keys.json` snippet, and `mods/<name>/`. Do not add `layouts/` to a mod distribution. Recipes describe real behavior and observable completion checks. Preserve upstream licenses in both the distribution and installed code. Follow [Herdr's sharing guide](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md#layouts-and-mods-other-people-made).

Never commit local account credentials, session transcripts, generated indexes, runtime paths, or personal Herdr state. Use synthetic data for tests and public screenshots. The screenshot fixture workflow is documented in [docs/media.md](docs/media.md).

## Pull requests

Explain the user-visible problem, the change, and how you checked it. Include before/after screenshots for visible changes and name the tested Herdr version. Add regression coverage for behavioral fixes. Keep unrelated cleanup separate.

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages and pull request titles, for example `fix(floatterm): restore a hidden terminal` or `feat(analytics): show a new quota window`. Use `!` or a `BREAKING CHANGE:` footer for incompatible changes. Prefer one mod per pull request so each release remains focused.

Configure a GitHub noreply email before committing if you do not want your personal address to become public. Never put personal addresses in examples or release notes.

## Releases

Floatterm and Analytics have independent versions, changelogs, release pull requests, and ZIPs. See [the release guide](docs/releasing.md) for the automated flow and GitHub App setup.
