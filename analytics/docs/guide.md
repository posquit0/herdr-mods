# Analytics

Native Herdr dashboard for local agent activity, token history, and optional account usage.

## Open

Follow the [installation guide](../README.md#install). Press **Cmd+Shift+A** to toggle the overlay without creating a tab. Close with the same shortcut, **Esc**, or **×**. Shortcuts apply while Herdr is active.

Node ≥22.15 is required. Analytics resolves `node` from the app environment unless `mods/analytics/runtime.json` supplies a Node executable. Resolution starts from the home directory to avoid project-specific runtime pins.

## Optional toolbar button

The shortcut and CLI entry work with your existing layout. To add a toolbar button, have your agent clone your current layout and insert `{ "mod": "analytics", "props": { "mode": "toolbar" } }` beside the native tabs. Preserve the tabs block and all existing controls. Toolbar mode only draws the button; it does not start its own collector. The default tooltip mentions Cmd+Shift+A, so adapt it if you choose a different shortcut.

No layout is included in this distribution. Never modify a shipped layout directly; Herdr replaces those files on startup.

## Reading the dashboard

- **Overview** starts with live Herdr agents, ordered by attention needed. Filter to this space or agents needing input/review; click an agent to open its terminal. Parent/child context includes live child agents without a pane. This list includes connected machines; their unavailable state is reported.
- Below that, select a period and optionally an agent tool, project, provider or model. Every usage metric in Overview and Sessions follows these filters. New input, output and input reuse explain what makes up the token total. Project changes compare the previous calendar period, with incomplete-history warnings.
- Click a project or tool to enter **Sessions**, then select a session to inspect its token components and models. The list shows the top 50 matching sessions by tokens; totals cover all matching sessions. Different tools' identical session IDs remain separate.
- **History** retains the original activity heatmap and lifetime statistics. Its period/facet filters apply to its Model usage section; the lifetime and activity sections remain global.
- **Accounts** contains the **Account usage lookup** setting and, when enabled, account quota windows. These percentages are separate from historical token counts.

Agent types use Herdr's own icons in live-agent rows, session rows, tool usage and data coverage. Hover over an icon to see its name; the same name is exposed to accessibility tools. Live rows honor the running program's icon, while known historical sources use Herdr's bundled agent icons. Unrecognized tools show initials with their full name on hover. Account headings, filter menus and settings keep readable text labels.

The Data coverage card reports source availability, scan progress, unknown project/model fields and scan errors. Live status is not an outcome evaluation; finished does not imply successful. Local files cannot establish complete cross-device token history, task quality or tool-error rates.

## Account usage lookup

**Disabled by default.** Enable **Account usage lookup** on the **Accounts** page to query account quotas. Existing preferences are preserved. Local session history, token totals, model rankings, activity heatmaps and period filters always work without account API access. Sources are Pi, Codex, Claude Code, OpenCode and Antigravity. Use Settings to change source paths, enabled sources, cache-token accounting and the local refresh interval.

Enabling the setting adds account-wide quota cards for the currently authenticated Claude, Codex and Kiro CLI accounts, including usage percentages and reset times. Automatic account lookup runs at most once every five minutes across Analytics views. **Refresh accounts** checks immediately, including after renewing a CLI login; it does not wait for the automatic interval. In-flight requests are shared and cannot be duplicated. Server rate-limit responses block both automatic and manual retries until their retry time (five minutes if the server supplies no usable time). Errors are shown per provider rather than as zero usage. There are no automatic login flows, token refreshes or credential-file writes.

Each provider has its own card: the large number is **remaining quota**, and the bar shows **used quota**. Session and weekly windows are separate from model/feature limits. Codex's plan is shown when supplied by the API. **Low headroom** means at least 80% used; **Limit reached** means at least 100%. These describe the reported quota, not guaranteed request availability. Reset countdowns include the exact local time. A passed reset asks for a fresh reading instead of assuming the quota recovered. Readings older than ten minutes are marked as last known. **Refresh accounts** refreshes only quotas. Its label shows elapsed time while fetching or a live countdown when the server requires a pause. Completion reports the number of updated accounts and names unavailable providers. The display timer runs while Accounts is selected and does not issue network requests.

Kiro shows monthly plan credits and, when the API reports an enabled positive allowance, overage credits separately. Each includes the used/allowed credit count. Overage is subtracted from total usage before calculating the plan gauge. Responses that combine bonus spending with plan spending show an unavailable-plan explanation rather than an inferred percentage. A missing allowance or reset time remains unavailable. This does not enable paid overage or change the Kiro account.

These APIs expose quota windows, not a complete token/billing history across devices. Local charts stay explicitly local; quota percentages are never summed together or added to token totals. Organization billing/admin APIs are not used. Other providers remain local-only.

The setting is saved in Herdr's `shared.json` under `analytics.accounts`, retaining the existing inverse `localOnly` field for compatibility. Disabling account lookup hides account data and invalidates in-flight results. A request already sent may finish, but no new account lookup starts. While disabled, account credentials are not read.

## Account sources

| Provider | Local credentials | Read-only endpoint |
|---|---|---|
| Codex | `$CODEX_HOME/auth.json`, otherwise `~/.codex/auth.json`; OAuth `tokens.access_token` and selected `account_id` | `https://chatgpt.com/backend-api/wham/usage` |
| Claude | `$CLAUDE_CONFIG_DIR/.credentials.json`, otherwise `~/.claude/.credentials.json`; on macOS, the default profile can fall back to Keychain service `Claude Code-credentials` | `https://api.anthropic.com/api/oauth/usage` |
| Kiro | `$KIRO_DATA_DIR/data.sqlite3`, otherwise macOS `~/Library/Application Support/kiro-cli/data.sqlite3` (Linux `$XDG_DATA_HOME/kiro-cli/data.sqlite3`, default `~/.local/share/kiro-cli/data.sqlite3`); opened read-only | `GetUsageLimits` at `https://codewhisperer.us-east-1.amazonaws.com/` or `https://q.eu-central-1.amazonaws.com/`, according to the CLI profile region |

Kiro uses the CLI's `auth_kv` token record and `state` profile record. A missing profile uses the US East endpoint for Builder ID; an invalid profile or unsupported region fails without sending its token elsewhere. Expired credentials must be renewed in Kiro CLI. The lookup does not start a `/usage` chat, a new CLI session, or automatic sign-in. Kiro account support does not add a local Kiro session-history collector.

Credentials must already exist. API-key-only Codex logins, custom Claude Keychain profiles and other applications' credential stores are not imported. The first Claude Keychain read may require macOS to allow access. Missing, expired or denied credentials are reported in the card; renew them in the corresponding CLI.

These account endpoints are not stable public billing APIs. Response changes can make a card unavailable.

## Data and privacy

- Local usage metadata and scan state live under `~/.config/herdr-app/data/analytics/`; raw prompts and responses are not saved by the collector.
- Only sanitized quota windows and status messages are shared with the UI. Credentials remain in the short-lived Node helper. No token is placed in subprocess arguments, mod config, logs or Herdr shared state.
- Network mode sends existing credentials only to fixed Claude, Codex and Kiro provider hosts. Redirects are rejected. Session transcripts are never uploaded.
- Runtime data and credentials must not be committed to this repository. Export produces a Markdown report of the local dashboard.

## Checks

From the repository root, run `npm test` with Node ≥22.15. Tests use synthetic credentials and sessions, including offline isolation, response redaction, provider failures, rate limits, shared state, late responses, local deduplication, scoped aggregation, and UI navigation.

Run `herdr-app check` on the installed mod folder and inspect the real dashboard in the running app. Initial native checks alone do not validate later asynchronous rendering.
