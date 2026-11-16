// Run with Node >=22.15: node --test tests/herdr-analytics.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { collectAccounts, parseUsage } from "../analytics/mods/analytics/accounts.mjs";
import { AccountState, ACCOUNT_STATE_KEY, ACCOUNT_REFRESH_MS } from "../analytics/mods/analytics/account-state.js";
import { accountDuration, quotaPresentation } from "../analytics/mods/analytics/account-presentation.js";
import { collectSnapshot } from "../analytics/mods/analytics/collector.mjs";

const codexUsage = { rate_limit: { primary_window: { used_percent: 25, reset_at: 1800000000, limit_window_seconds: 18000 } } };
const claudeUsage = { five_hour: { utilization: 12.5, resets_at: "2026-11-16T12:00:00Z" }, seven_day: { utilization: 40, resets_at: null } };
const kiroUsage = { nextDateReset: 1796083200, usageBreakdownList: [{ resourceType: "CREDIT", currentUsageWithPrecision: 25, usageLimitWithPrecision: 100 }] };
const missing = () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; };

function environment(overrides = {}) {
  const calls = [];
  return {
    calls, home: "/fixture", env: {}, platform: "linux", now: () => 1000,
    readKiroState: async () => ({ token: { access_token: "kiro-secret" }, profile: null }),
    readFile: async (file) => JSON.stringify(file.endsWith("/.credentials.json")
      ? { claudeAiOauth: { accessToken: "claude-secret", expiresAt: 100000 } }
      : { tokens: { access_token: "codex-secret", account_id: "selected-account" } }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => url.includes("amazonaws.com") ? kiroUsage : url.includes("anthropic") ? claudeUsage : codexUsage };
    },
    execFile: async () => { throw new Error("unexpected keychain access"); },
    ...overrides,
  };
}

test("local-only defaults to zero credentials, keychain and network access", async () => {
  const unexpected = () => { assert.fail("local-only crossed the account boundary"); };
  const io = environment({ readFile: unexpected, readKiroState: unexpected, execFile: unexpected, fetch: unexpected });
  assert.deepEqual(await collectAccounts({}, io), { version: 1, entries: [] });
  assert.deepEqual(await collectAccounts({ localOnly: true }, io), { version: 1, entries: [] });
});

test("account mode uses fixed endpoints and selected account; output contains no credentials", async () => {
  const io = environment();
  const result = await collectAccounts({ localOnly: false }, io);
  assert.equal(result.entries.length, 3);
  assert.ok(result.entries.every((entry) => entry.status === "ok"));
  assert.equal(io.calls.length, 3);
  const codex = io.calls.find((call) => call.url === "https://chatgpt.com/backend-api/wham/usage");
  assert.equal(codex.options.headers["ChatGPT-Account-Id"], "selected-account");
  assert.ok(io.calls.every((call) => call.options.redirect === "error"));
  assert.ok(io.calls.filter((call) => !call.url.includes("amazonaws.com")).every((call) => call.options.method === "GET"));
  assert.equal(io.calls.find((call) => call.url.includes("anthropic")).options.headers["anthropic-beta"], "oauth-2025-04-20");
  const kiro = io.calls.find((call) => call.url.includes("amazonaws.com"));
  assert.equal(kiro.options.method, "POST");
  assert.equal(kiro.options.headers["X-Amz-Target"], "AmazonCodeWhispererService.GetUsageLimits");
  assert.equal(kiro.options.headers["Authorization"], "Bearer kiro-secret");
  assert.equal(kiro.options.body, "{}");
  assert.doesNotMatch(JSON.stringify(result), /secret|selected-account|Authorization/);
});

test("unknown usage is unavailable, while genuine zero is retained", () => {
  assert.throws(() => parseUsage("Codex", {}), /no supported/);
  assert.throws(() => parseUsage("Claude", { five_hour: { utilization: null } }), /no supported/);
  const result = parseUsage("Claude", { five_hour: { utilization: 0 } });
  assert.equal(result.windows[0].usedPercent, 0);
  assert.equal(result.windows[0].resetsAt, null);
});

test("quota metadata preserves plan and distinguishes actual durations and additional limits", () => {
  const result = parseUsage("Codex", { ...codexUsage, plan_type: "pro", account_id: "private-account", additional_rate_limits: [null, {
    limit_name: "Spark", rate_limit: { secondary_window: { used_percent: 80, limit_window_seconds: 604800 } },
  }] });
  assert.equal(result.plan, "pro");
  assert.equal(result.windows[0].label, "Session · 5 hours");
  assert.equal(result.windows[0].scope, "main");
  assert.equal(result.windows[1].label, "Spark · Weekly · 7 days");
  assert.equal(result.windows[1].scope, "additional");
  assert.doesNotMatch(JSON.stringify(result), /private-account/);
  const claude = parseUsage("Claude", { ...claudeUsage, seven_day_opus: { utilization: 95 } });
  assert.equal(claude.windows[2].scope, "additional");
});

test("quota display handles unknown, zero, warning, over-limit, stale and passed resets", () => {
  const now = Date.parse("2026-11-16T00:00:00Z");
  const show = (usedPercent, resetsAt = "2026-11-16T01:00:00Z", stale = false) => quotaPresentation({ usedPercent, resetsAt }, now, stale);
  for (const missing of [null, undefined, NaN, -1, "25"]) {
    assert.equal(show(missing).remaining, "—");
    assert.equal(show(missing).status, "Unavailable");
  }
  assert.equal(show(0).remaining, "100.0%");
  assert.equal(show(79.9).status, "");
  assert.equal(show(80).status, "Low headroom");
  assert.equal(show(100).status, "Limit reached");
  assert.equal(show(120).remaining, "0.0%");
  assert.equal(show(120).fill, 100);
  assert.equal(show(120).used, "120.0% used");
  assert.equal(show(85).reset, "Resets in 1h");
  assert.equal(show(85, null).reset, "Reset time unavailable");
  assert.equal(show(85, "invalid").resetAt, null);
  assert.equal(show(85, "2026-11-15T00:00:00Z").status, "Awaiting refresh");
  assert.equal(show(85, undefined, true).status, "Last known");
  assert.equal(accountDuration(1), "1m");
  assert.equal(accountDuration(90000000), "1d 1h");
});

test("one provider failure never removes another provider's successful data", async () => {
  const io = environment();
  const fetch = io.fetch;
  io.fetch = (url, options) => url.includes("anthropic")
    ? Promise.resolve({ status: 401, ok: false }) : fetch(url, options);
  const { entries } = await collectAccounts({ localOnly: false }, io);
  assert.equal(entries[0].status, "ok");
  assert.equal(entries[1].status, "error");
  assert.match(entries[1].message, /access was denied/);
});

test("network errors and invalid credential contents never leak into the output", async () => {
  for (const overrides of [
    { fetch: async () => { throw new Error("Authorization: Bearer secret"); } },
    { readFile: async () => "token-secret-invalid-json", readKiroState: async () => { throw new Error("kiro-secret"); } },
  ]) {
    const result = await collectAccounts({ localOnly: false }, environment(overrides));
    assert.ok(result.entries.every((entry) => entry.status === "error"));
    assert.doesNotMatch(JSON.stringify(result), /secret|Bearer/);
  }
});

test("expired native credentials require renewal without a network call", async () => {
  const jwt = `a.${Buffer.from(JSON.stringify({ exp: 0 })).toString("base64url")}.b`;
  const io = environment({ readKiroState: async () => ({ token: { access_token: "kiro-secret", expires_at: "1970-01-01T00:00:00Z" }, profile: null }), readFile: async (file) => JSON.stringify(file.endsWith("/.credentials.json")
    ? { claudeAiOauth: { accessToken: "secret", expiresAt: 0 } }
    : { tokens: { access_token: jwt } }) });
  const result = await collectAccounts({ localOnly: false }, io);
  assert.equal(io.calls.length, 0);
  assert.ok(result.entries.every((entry) => /expired/.test(entry.message)));
});

test("macOS Claude reads the exact CLI Keychain item only when its file is absent", async () => {
  const io = environment({ platform: "darwin", readFile: missing });
  let keychainCalls = 0;
  io.execFile = async (command, args) => {
    keychainCalls++;
    assert.equal(command, "/usr/bin/security");
    assert.deepEqual(args, ["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
    return { stdout: JSON.stringify({ claudeAiOauth: { accessToken: "keychain-secret" } }) };
  };
  const result = await collectAccounts({ localOnly: false }, io);
  assert.equal(keychainCalls, 1);
  assert.equal(result.entries[1].status, "ok");
  assert.doesNotMatch(JSON.stringify(result), /keychain-secret/);
});

test("explicit credential homes do not fall back to another login", async () => {
  const paths = [];
  const io = environment({ platform: "darwin", env: { CODEX_HOME: "/custom-codex", CLAUDE_CONFIG_DIR: "/custom-claude", KIRO_DATA_DIR: "/custom-kiro" }, readKiroState: (file) => { paths.push(file); return missing(); }, readFile: (file) => { paths.push(file); return missing(); } });
  const result = await collectAccounts({ localOnly: false }, io);
  assert.deepEqual(paths.sort(), ["/custom-claude/.credentials.json", "/custom-codex/auth.json", "/custom-kiro/data.sqlite3"]);
  assert.equal(io.calls.length, 0);
  assert.ok(result.entries.every((entry) => entry.status === "error"));
});

test("429 honors Retry-After without immediate retries", async () => {
  let calls = 0;
  const io = environment({ fetch: async () => { calls++; return { ok: false, status: 429, headers: new Headers({ "retry-after": "900" }) }; } });
  const result = await collectAccounts({ localOnly: false }, io);
  assert.equal(calls, 3);
  assert.equal(result.retryAfterMs, 900000);
});

test("429 without a usable Retry-After still blocks immediate manual retry", async () => {
  for (const value of [null, "invalid", "0"]) {
    const io = environment({ fetch: async () => ({ ok: false, status: 429, headers: new Headers(value === null ? {} : { "retry-after": value }) }) });
    const result = await collectAccounts({ localOnly: false }, io);
    assert.equal(result.retryAfterMs, ACCOUNT_REFRESH_MS);
  }
});

test("Kiro separates monthly plan and overage credits without double counting", () => {
  const data = { ...kiroUsage, overageConfiguration: { overageStatus: "ENABLED" }, usageBreakdownList: [{
    resourceType: "CREDIT", currentUsageWithPrecision: 125.5, usageLimitWithPrecision: 100,
    currentOveragesWithPrecision: 25.5, overageCapWithPrecision: 200,
  }] };
  const entry = parseUsage("Kiro", data);
  assert.equal(entry.windows[0].usedPercent, 100);
  assert.equal(entry.windows[0].usedCredits, 100);
  assert.equal(entry.windows[1].usedCredits, 25.5);
  assert.equal(entry.windows[1].usedPercent, 12.75);
  assert.equal(entry.windows[1].scope, "additional");
  assert.equal(entry.windows[0].resetsAt, "2026-12-01T00:00:00.000Z");
  data.usageBreakdownList[0].bonuses = [{}];
  const bonus = parseUsage("Kiro", data);
  assert.equal(bonus.windows.length, 1);
  assert.equal(bonus.windows[0].label, "Overage credits");
  assert.match(bonus.note, /combines plan and bonus/);
});

test("Kiro missing, malformed and zero credit allowances never become a misleading gauge", () => {
  assert.throws(() => parseUsage("Kiro", {}), /credit balance/);
  assert.throws(() => parseUsage("Kiro", { usageBreakdownList: [...kiroUsage.usageBreakdownList, ...kiroUsage.usageBreakdownList] }), /credit balance/);
  for (const patch of [
    { currentUsageWithPrecision: -1 }, { currentUsageWithPrecision: "25" },
    { currentOveragesWithPrecision: 26 }, { currentOveragesWithPrecision: -1 },
    { usageLimitWithPrecision: null }, { currentUsageWithPrecision: 101 },
  ]) {
    assert.throws(() => parseUsage("Kiro", { ...kiroUsage, usageBreakdownList: [{ ...kiroUsage.usageBreakdownList[0], ...patch }] }), /credit balance/);
  }
  const zero = parseUsage("Kiro", { usageBreakdownList: [{ resourceType: "CREDIT", currentUsageWithPrecision: 0, usageLimitWithPrecision: 0 }] });
  assert.equal(zero.windows.length, 0);
  assert.match(zero.note, /allowance/);
  const disabled = parseUsage("Kiro", { ...kiroUsage, overageConfiguration: { overageStatus: "DISABLED" } });
  assert.match(disabled.note, /disabled/);
  const missingReset = parseUsage("Kiro", { ...kiroUsage, nextDateReset: 1796083200000 });
  assert.equal(missingReset.windows[0].resetsAt, null);
});

test("Kiro routes only supported profile regions and never exposes profile identifiers", async () => {
  for (const [region, endpoint] of [
    ["us-east-1", "https://codewhisperer.us-east-1.amazonaws.com/"],
    ["eu-central-1", "https://q.eu-central-1.amazonaws.com/"],
  ]) {
    const arn = `arn:aws:codewhisperer:${region}:123456789012:profile/private-profile`;
    const io = environment({ readKiroState: async () => ({ token: { access_token: "kiro-secret" }, profile: { arn } }) });
    const result = await collectAccounts({ localOnly: false }, io);
    const call = io.calls.find((call) => call.url.includes("amazonaws.com"));
    assert.equal(call.url, endpoint);
    assert.deepEqual(JSON.parse(call.options.body), { profileArn: arn });
    assert.doesNotMatch(JSON.stringify(result), /kiro-secret|private-profile|123456789012/);
  }
  for (const profile of [{}, { arn: "https://malicious.example/" }, { arn: "arn:aws:codewhisperer:ap-northeast-2:123456789012:profile/test" }]) {
    const io = environment({ readKiroState: async () => ({ token: { access_token: "kiro-secret" }, profile }) });
    const result = await collectAccounts({ localOnly: false }, io);
    assert.equal(io.calls.length, 2);
    assert.equal(result.entries[2].status, "error");
    assert.ok(result.entries.slice(0, 2).every((entry) => entry.status === "ok"));
  }
});

test("Kiro reads its SQLite state without modifying it, supports BLOB profiles and fails closed on malformed rows", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "analytics-kiro-"));
  const file = path.join(dir, "data.sqlite3");
  try {
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE auth_kv (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE state (key TEXT PRIMARY KEY, value BLOB)");
    db.prepare("INSERT INTO auth_kv VALUES (?, ?)").run("kirocli:odic:token", JSON.stringify({ access_token: "kiro-secret" }));
    db.prepare("INSERT INTO state VALUES (?, ?)").run("api.codewhisperer.profile", Buffer.from(JSON.stringify({ arn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test" })));
    db.close();
    const before = await readFile(file);
    const io = environment({ env: { KIRO_DATA_DIR: dir } });
    delete io.readKiroState;
    const result = await collectAccounts({ localOnly: false }, io);
    assert.equal(result.entries[2].status, "ok");
    assert.deepEqual(await readFile(file), before);
    const bad = new DatabaseSync(file);
    bad.prepare("UPDATE state SET value = ?").run("null");
    bad.close();
    io.calls.length = 0;
    const failed = await collectAccounts({ localOnly: false }, io);
    assert.equal(failed.entries[2].status, "error");
    assert.equal(io.calls.length, 2);
    io.env.KIRO_DATA_DIR = path.join(dir, "missing");
    const missing = await collectAccounts({ localOnly: false }, io);
    assert.equal(missing.entries[2].status, "error");
    await assert.rejects(readFile(path.join(io.env.KIRO_DATA_DIR, "data.sqlite3")), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

function stateHarness() {
  const values = new Map();
  const pending = [];
  const tasks = [];
  let now = 100000;
  const host = {
    shared: (key) => values.get(key), setShared: (key, value) => values.set(key, value),
    now: () => now, ready: () => true,
    collect: () => new Promise((resolve) => pending.push(resolve)),
  };
  const cx = { spawn: (fn) => tasks.push(fn(cx)), notify() {} };
  return { host, cx, pending, tasks, values, advance: (ms) => { now += ms; }, state: new AccountState(host) };
}
const result = (provider = "Codex", retryAfterMs = 0) => ({ code: 0, stdout: JSON.stringify({ version: 1, entries: [{ provider, status: "ok", windows: [] }], retryAfterMs }) });

test("toggle is persisted, shared across panes, and deduplicates requests", async () => {
  const h = stateHarness();
  h.state.refresh(h.cx);
  assert.equal(h.pending.length, 0);
  h.state.setLocalOnly(false, h.cx);
  const another = new AccountState(h.host);
  assert.equal(another.localOnly(), false);
  another.refresh(h.cx);
  assert.equal(h.pending.length, 1);
  h.pending[0](result());
  await Promise.all(h.tasks);
  another.refresh(h.cx);
  assert.equal(h.pending.length, 1);
  h.advance(ACCOUNT_REFRESH_MS + 1);
  another.refresh(h.cx);
  assert.equal(h.pending.length, 2);
  h.pending[1](result());
  await Promise.all(h.tasks);
});

test("toggle on discards a late response, including off-on-off races", async () => {
  const h = stateHarness();
  h.state.setLocalOnly(false, h.cx);
  h.state.setLocalOnly(true, h.cx);
  h.state.refresh(h.cx);
  assert.equal(h.pending.length, 1);
  h.state.setLocalOnly(false, h.cx);
  assert.equal(h.pending.length, 1, "a toggle must not bypass the cooldown");
  h.advance(ACCOUNT_REFRESH_MS + 1);
  h.state.refresh(h.cx);
  h.pending[0](result("old"));
  await h.tasks[0];
  assert.equal(h.state.state().entries, undefined);
  h.pending[1](result("new"));
  await h.tasks[1];
  assert.equal(h.values.get(ACCOUNT_STATE_KEY).entries[0].provider, "new");
});

test("shared account scheduling respects a provider's longer backoff", async () => {
  const h = stateHarness();
  h.state.setLocalOnly(false, h.cx);
  h.pending[0](result("Codex", 900000));
  await h.tasks[0];
  h.advance(ACCOUNT_REFRESH_MS + 1);
  h.state.refresh(h.cx);
  assert.equal(h.pending.length, 1);
});

test("manual refresh bypasses only automatic scheduling, not in-flight work or server backoff", async () => {
  const h = stateHarness();
  h.state.setLocalOnly(false, h.cx);
  assert.equal(h.state.refresh(h.cx, { manual: true }).kind, "pending");
  h.pending[0](result());
  await h.tasks[0];
  assert.equal(h.state.refresh(h.cx).kind, "scheduled");
  assert.equal(h.state.refresh(h.cx, { manual: true }).kind, "started");
  const other = new AccountState(h.host);
  assert.equal(other.refresh(h.cx, { manual: true }).kind, "pending");
  h.pending[1](result("Kiro", 900000));
  await h.tasks[1];
  assert.deepEqual(other.refresh(h.cx, { manual: true }), { kind: "rate-limited", waitMs: 900000 });
  h.advance(899000);
  assert.deepEqual(other.refresh(h.cx, { manual: true }), { kind: "rate-limited", waitMs: 1000 });
  assert.equal(h.pending.length, 2);
  h.advance(1000);
  assert.equal(other.refresh(h.cx, { manual: true }).kind, "started");
  h.pending[2](result());
  await h.tasks[2];
  assert.equal(h.state.state().retryAt, 0);
});

test("manual refresh is blocked while disabled or unready and preserves legacy server backoff", () => {
  const h = stateHarness();
  assert.equal(h.state.refresh(h.cx, { manual: true }).kind, "disabled");
  h.values.set(ACCOUNT_STATE_KEY, { localOnly: false });
  h.host.ready = () => false;
  assert.equal(h.state.refresh(h.cx, { manual: true }).kind, "not-ready");
  h.host.ready = () => true;
  h.values.set(ACCOUNT_STATE_KEY, { localOnly: false, updatedAt: 100000, nextRefreshAt: 1000000 });
  assert.equal(h.state.refresh(h.cx, { manual: true }).kind, "rate-limited");
  assert.equal(h.pending.length, 0);
});

test("local collector counts usage once after repeated scans and copied sessions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "analytics-test-"));
  try {
    const sessions = path.join(root, ".pi/agent/sessions");
    await mkdir(sessions, { recursive: true });
    const transcript = [
      { type: "session", id: "session-one", timestamp: "2026-11-16T10:00:00Z", cwd: "/fixture/repo" },
      { type: "message", id: "answer-one", timestamp: "2026-11-16T10:00:01Z", message: {
        role: "assistant", model: "test-model", provider: "test-provider", content: [{ type: "text", text: "private fixture content" }],
        usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17 },
      } },
    ].map(JSON.stringify).join("\n") + "\n";
    await writeFile(path.join(sessions, "one.jsonl"), transcript);
    await writeFile(path.join(sessions, "copy.jsonl"), transcript);
    const options = { home: root, store: path.join(root, "data/analytics.json"), config: JSON.stringify({ sources: [{ id: "pi", label: "Pi", adapter: "pi", enabled: true, roots: [sessions] }] }) };
    const first = await collectSnapshot("configure", options);
    const second = await collectSnapshot("snapshot", options);
    assert.equal(first.rows.length, 1);
    assert.deepEqual(first.rows, second.rows);
    assert.equal(first.rows[0].tokens.input, 10);
    assert.equal(first.rows[0].tokens.output, 5);
    assert.doesNotMatch(JSON.stringify(first), /private fixture content/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
