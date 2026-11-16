// Exercise real view handlers with synthetic host data, without starting Herdr.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveDashboard, compactDashboard } from "../analytics/mods/analytics/analytics.js";

const root = new URL("../analytics/mods/analytics/", import.meta.url);
const elements = [];
function element(id) {
  const state = { key: id, nodes: [], handlers: {} };
  const view = new Proxy(state, { get(target, key) {
    if (key in target) return target[key];
    if (key === "then" || typeof key === "symbol") return undefined;
    return (...args) => {
      if (key === "id") state.key = args[0];
      else if (key === "child") state.nodes.push(args[0]);
      else if (key === "children") state.nodes.push(...args[0]);
      else if (key === "when" && args[0]) args[1](view);
      else if (key === "tooltip" || key === "accessibility_label") state[`${key}Value`] = args[0];
      else if (key.startsWith("on_")) state.handlers[key] = args.at(-1);
      return view;
    };
  }});
  elements.push(view);
  return view;
}

const calls = [];
let toolbar = false;
const host = {
  appHome: () => "/fixture", home: () => "/fixture", theme: () => ({}), settings: () => ({}),
  props: () => toolbar ? { mode: "toolbar" } : {}, shared: () => null, setShared() {},
  spaces: () => [{ id: "space", name: "Fixture", active: true, tabs: [] }],
  agents: () => [{ address: "agent", space: "space", status: "blocked", title: "Waiting", app: "Codex" }],
  terminals: () => [], machines: () => [{ name: null, layout: "ready" }], panes: () => [],
  run: (...args) => calls.push(args),
  closeOverlay: (id) => calls.push(["closeOverlay", id]),
};
const native = { View: class {}, div: element, svg: element, image: element, v_flex: element, h_flex: element,
  Button: { new: element }, Toggle: { new: element }, Popover: { new: element } };
globalThis.__analyticsUI = { native, host };
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
function replaceHost(source) {
  return source.replace(/import \{([^}]+)\} from "(gpui-kit|gpui-base|herdr)";/g,
    (_, names, module) => `const {${names}} = globalThis.__analyticsUI.${module === "herdr" ? "host" : "native"};`);
}
const uiUrl = dataUrl(replaceHost(await readFile(new URL("ui.js", root), "utf8")));
const source = replaceHost(await readFile(new URL("main.js", root), "utf8"))
  .replaceAll('"./ui.js"', JSON.stringify(uiUrl))
  .replace(/"\.\/([\w-]+\.js)"/g, (_, name) => JSON.stringify(new URL(name, root).href));
const { default: Analytics } = await import(dataUrl(source));
const fixture = { rows: [
  { day: "2026-11-16", harness: "codex", project: "/repo/a", session: "a", model: "m", provider: "openai", messages: 1, tokens: { input: 10, output: 20 } },
  { day: "2026-11-16", harness: "codex", project: "/repo/b", session: "b", model: "m", provider: "openai", messages: 1, tokens: { input: 50, output: 20 } },
], sourceStats: { codex: { status: "ok" } }, config: {}, stats: { errors: 0 } };
const cx = { spawn: () => ({ cancel() {} }), notify() {}, timer: { every: () => ({ cancel() {} }) } };
function setup() {
  toolbar = false; calls.length = 0;
  const view = new Analytics(); view.init({}, cx);
  view.snapshot = fixture; view.period = "today";
  view.scheduleDashboard = () => {
    view.dashboard = compactDashboard(deriveDashboard(fixture, { today: "2026-11-16", period: view.period, filters: view.filters }));
  };
  view.scheduleDashboard();
  return view;
}
function render(view) { elements.length = 0; view.render(cx); }
function click(id, clickCx = cx) {
  const node = elements.find((node) => node.key === id);
  assert.ok(node?.handlers.on_click, `clickable ${id}`);
  node.handlers.on_click({}, clickCx);
}
function text() { return elements.flatMap((node) => node.nodes.filter((value) => typeof value === "string")).join("\n"); }

test("project drilldown and session selection use actual view click handlers", () => {
  const view = setup(); render(view);
  assert.match(text(), /Live agents/);
  const icon = elements.find((node) => node.key === "analytics-live-icon-agent");
  assert.equal(icon.tooltipValue, "Codex");
  assert.equal(icon.accessibility_labelValue, "Codex");
  assert.doesNotMatch(text(), /Codex · Waiting/);
  click("analytics-group-project-/repo/a"); render(view);
  assert.equal(view.page, "sessions");
  assert.equal(view.dashboard.operations.totals.total, 30);
  assert.equal(view.dashboard.operations.sessions.length, 1);
  assert.ok(elements.some((node) => String(node.key).startsWith("analytics-session-icon-") && node.tooltipValue === "Codex"));
  click(`analytics-session-${view.dashboard.operations.sessions[0].key}`); render(view);
  assert.match(text(), /Selected session/);
  assert.match(text(), /Uncached input 10 · output 20/);
});

test("page navigation, empty state and live agent navigation remain functional", () => {
  const view = setup(); render(view);
  click("analytics-agent-agent");
  assert.deepEqual(calls.pop(), ["agent.focus", { terminal: "agent" }]);
  for (const page of ["history", "accounts", "sessions", "overview"]) {
    click(`analytics-pages-${page}`); render(view);
    assert.equal(view.page, page);
  }
  view.drilldown("project", "missing", cx); render(view);
  assert.match(text(), /No recorded sessions match/);
});

test("toolbar opens Analytics without starting collector tasks", () => {
  toolbar = true; calls.length = 0;
  const view = new Analytics();
  view.init({}, { spawn() { assert.fail("toolbar starts no tasks"); } });
  render(view); click("analytics-open");
  assert.deepEqual(calls, [["mod.open", { name: "analytics" }]]);
  toolbar = false;
});

test("overlay close button closes its own overlay without touching tabs", () => {
  const view = setup();
  view.overlay = "analytics-overlay";
  render(view); click("analytics-close");
  assert.deepEqual(calls, [["closeOverlay", "analytics-overlay"]]);
});

test("agent navigation dismisses the overlay before focusing the terminal", () => {
  const view = setup();
  view.overlay = "analytics-overlay";
  render(view); click("analytics-agent-agent");
  assert.deepEqual(calls, [["closeOverlay", "analytics-overlay"], ["agent.focus", { terminal: "agent" }]]);
});

test("account lookup setting lives on Accounts and preserves the inverse saved preference", () => {
  let saved = { localOnly: false, entries: [{ provider: "Codex", status: "ok", windows: [{ label: "Weekly", usedPercent: 25 }] }] };
  const view = setup();
  view.accounts.host.shared = () => saved;
  view.accounts.host.setShared = (_key, value) => { saved = value; };
  render(view);
  assert.doesNotMatch(text(), /Local-only/);
  assert.ok(!elements.some((node) => node.key === "analytics-account-usage"));
  click("analytics-pages-accounts"); render(view);
  assert.match(text(), /Account usage lookup/);
  assert.match(text(), /75.0%/);
  assert.match(text(), /25.0% used/);
  elements.find((node) => node.key === "analytics-account-usage").handlers.on_change(false, cx);
  render(view);
  assert.equal(saved.localOnly, true);
  assert.match(text(), /Disabled · account credentials are not read/);
  assert.doesNotMatch(text(), /25.0% used/);
  elements.find((node) => node.key === "analytics-account-usage").handlers.on_change(true, cx);
  render(view);
  assert.equal(saved.localOnly, false);
  assert.match(text(), /25.0% used/);
});

test("account cards separate feature limits, explain errors and allow manual refresh", () => {
  const view = setup();
  view.page = "accounts";
  view.nodeBinary = "/fixture/node";
  const now = Date.now();
  const saved = { localOnly: false, updatedAt: now, nextRefreshAt: now + 60000, entries: [
    { provider: "Codex", plan: "pro", status: "ok", windows: [
      { label: "Weekly · 7 days", usedPercent: 85, resetsAt: new Date(now + 3600000).toISOString() },
      { label: "Spark · Session", scope: "additional", usedPercent: 0 },
    ] },
    { provider: "Claude", status: "error", message: "Renew the CLI login." },
  ] };
  view.accounts.host.shared = () => saved;
  let refreshes = 0;
  view.accounts.refresh = (_cx, options) => { assert.equal(options.manual, true); refreshes++; };
  render(view);
  assert.match(text(), /Plan · pro/);
  assert.match(text(), /15.0%/);
  assert.match(text(), /Low headroom/);
  assert.match(text(), /MODEL & FEATURE LIMITS/);
  assert.match(text(), /100.0%/);
  assert.match(text(), /Resets in 1h/);
  assert.match(text(), /Renew the CLI login/);
  assert.match(text(), /You can refresh manually now/);
  click("analytics-account-refresh");
  assert.equal(refreshes, 1);
  saved.nextRefreshAt = now - 1;
  render(view); click("analytics-account-refresh");
  assert.equal(refreshes, 2);
});

test("Kiro cards show credit amounts and preserve an unavailable monthly quota", () => {
  const view = setup();
  view.page = "accounts";
  const entry = { provider: "Kiro", status: "ok", windows: [
    { label: "Monthly credits", usedPercent: 25, usedCredits: 25, limitCredits: 100 },
    { label: "Overage credits", scope: "additional", usedPercent: 0, usedCredits: 0, limitCredits: 200 },
  ] };
  view.accounts.host.shared = () => ({ localOnly: false, entries: [entry] });
  render(view);
  assert.match(text(), /Kiro/);
  assert.match(text(), /25.00 \/ 100.00 credits used/);
  assert.match(text(), /ADDITIONAL CREDITS/);
  entry.windows = [];
  entry.note = "Monthly plan usage unavailable: Kiro combines plan and bonus credits in this response.";
  render(view);
  assert.match(text(), /combines plan and bonus/);
  assert.doesNotMatch(text(), /0.0% used/);
});

test("manual account refresh starts a request during the automatic refresh interval", () => {
  const view = setup();
  view.page = "accounts";
  view.nodeBinary = "/fixture/node";
  const now = Date.now();
  let saved = { localOnly: false, updatedAt: now - 60000, nextRefreshAt: now + 240000, entries: [] };
  view.accounts.host.shared = () => saved;
  view.accounts.host.setShared = (_key, value) => { saved = value; };
  render(view);
  click("analytics-account-refresh");
  assert.equal(typeof saved.request, "string", "the manual click must start a request instead of silently doing nothing");
});

test("account refresh shows progress, blocks duplicate clicks, and reports per-provider failures", async () => {
  const view = setup();
  view.page = "accounts";
  view.nodeBinary = "/fixture/node";
  let saved = { localOnly: false };
  view.accounts.host.shared = () => saved;
  view.accounts.host.setShared = (_key, value) => { saved = value; };
  let finish;
  let requests = 0;
  view.accounts.host.collect = () => { requests++; return new Promise((resolve) => { finish = resolve; }); };
  const tasks = [];
  const clickCx = { ...cx, spawn: (fn) => tasks.push(fn(cx)) };
  render(view); click("analytics-account-refresh", clickCx); render(view);
  assert.match(text(), /Refreshing… 0:0[01]/);
  assert.match(text(), /Fetching latest account data/);
  click("analytics-account-refresh", clickCx);
  assert.equal(requests, 1);
  finish({ code: 0, stdout: JSON.stringify({ version: 1, entries: [
    { provider: "Codex", status: "ok", windows: [] },
    { provider: "Kiro", status: "error", message: "Kiro login has expired." },
  ] }) });
  await Promise.all(tasks); render(view);
  assert.match(text(), /Refresh complete · 1 updated · Unavailable: Kiro · just now/);
  assert.match(text(), /Retry accounts/);
  assert.doesNotMatch(text(), /Refreshing… \d/);
  click("analytics-account-refresh", clickCx);
  assert.equal(requests, 2, "login-related errors can be retried immediately after signing in");
  finish({ code: 0, stdout: JSON.stringify({ version: 1, entries: [{ provider: "Kiro", status: "ok", windows: [] }] }) });
  await Promise.all(tasks); render(view);
  assert.match(text(), /Refresh complete · 1 updated · just now/);
  assert.doesNotMatch(text(), /Unavailable: Kiro/);
});

test("server backoff has a live countdown and becomes clickable without navigation", () => {
  const view = setup();
  view.nodeBinary = "/fixture/node";
  const originalNow = Date.now;
  let now = originalNow();
  let tick;
  let cancelled = 0;
  let notifications = 0;
  Date.now = () => now;
  view.accounts.host.now = () => now;
  const retryAt = now + 65000;
  view.accounts.host.shared = () => ({ localOnly: false, retryAt });
  const pageCx = { ...cx, notify: () => { notifications++; }, timer: { every: (ms, fn) => {
    assert.equal(ms, 1000); tick = fn; return { cancel() { cancelled++; } };
  } } };
  try {
    view.setPage("accounts", pageCx); render(view);
    assert.match(text(), /Retry in 1:05/);
    assert.match(text(), /account API requested a pause/);
    now += 1000; tick(pageCx); render(view);
    assert.equal(notifications, 1);
    assert.match(text(), /Retry in 1:04/);
    now += 64000; tick(pageCx); render(view);
    assert.match(text(), /↻ Refresh accounts/);
    let refreshed = false;
    view.accounts.refresh = () => { refreshed = true; };
    click("analytics-account-refresh");
    assert.equal(refreshed, true);
    view.setPage("overview", pageCx);
    assert.equal(cancelled, 1);
  } finally { Date.now = originalNow; }
});
