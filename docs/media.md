# Screenshot provenance

Public screenshots are native frames captured by `herdr-app shot`, using Herdr Desktop 0.1.16 on macOS. They are not HTML recreations or AI-generated product mockups. No private sessions, account readings, credentials, or personal project names are included.

## Analytics

`scripts/prepare-media.mjs` copies the actual Analytics view into a temporary mod and substitutes synthetic session, agent, and account data. The collector is disabled; fake account responses remain in memory. The UI's rendering code is reused. Generate the disposable bundle with Node ≥22.15:

```sh
node scripts/prepare-media.mjs /tmp/herdr-mods-media
```

The destination must not already exist. This only writes files in that destination; it does not install or open anything. To capture, record your current layout, copy the generated preview mod and layouts to your running Herdr app home only if those names are unused, and select a preview layout. Use the same running app; do not start a second app/core environment. The preview includes inert export/save actions and fake agents: it is a capture fixture, not an installable product variant.

Capture with `herdr-app shot /path/to/image.png`. Restore the original layout and remove only the temporary preview files when finished. Preview layouts are development fixtures and are never included in either mod's distribution folder.

## Floatterm

Floatterm screenshots use the real launcher and Lazygit in a disposable local Git repository named **Harbor**. The repository contains synthetic TypeScript files and two sample commits attributed to `Demo Developer <demo@example.com>`. Lazygit auto-fetch and update checks are disabled for capture. The background is a real terminal displaying a sample file, not a personal workspace.

For isolation, use a renamed copy of Floatterm with updated self references and entry IDs prefixed with `demo-`. Point its sample configuration at the disposable repository. Record the demo space and terminal IDs so cleanup cannot touch existing sessions. After capture, close the demo's terminals and space, restore the original layout/focus, and remove only the fixture mod and layout.

## Publishing media

Inspect every full-resolution image before committing. Captions must disclose synthetic data. Keep `preview.png` at each mod's distribution root and link extra views from its README. Never use a screenshot of live account or session data as a convenient substitute for these fixtures.
