// node --test tests/herdr-analytics-operations.test.mjs (Node >=22.15)
import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { deriveDashboard, compactDashboard, dashboardMarkdown, periodRange } from "../analytics/mods/analytics/analytics.js";
import { fleetSnapshot } from "../analytics/mods/analytics/fleet.js";

const today = "2026-11-16";
function row(extra = {}) {
  return { day: today, harness: "codex", session: "one", project: "/repo/a", model: "model-a", provider: "openai", messages: 1,
    tokens: { input: 10, output: 5, cacheRead: 80, cacheWrite: 10, reasoning: 2 }, ...extra };
}
function snapshot(rows) {
  return { config: { sources: [{ id: "codex", label: "Codex", adapter: "codex", enabled: true, roots: [] }] }, rows,
    sourceStats: { codex: { status: "ok", files: 2, errors: 0 } }, stats: { errors: 0 }, warnings: [], scan: { status: "idle" } };
}
function derive(rows, options = {}) {
  return compactDashboard(deriveDashboard(snapshot(rows), { period: "today", today, ...options }));
}

test("selected period, project, source and model constrain every operations metric", () => {
  const data = derive([row(), row({ day: "2026-11-15", session: "yesterday" }), row({ project: "/repo/b" }), row({ harness: "claude" }), row({ model: "other" })],
    { filters: { project: "/repo/a", source: "codex", model: "model-a" } });
  assert.equal(data.operations.totals.total, 105);
  assert.equal(data.operations.sessions.length, 1);
  assert.equal(data.operations.projects.length, 1);
  assert.equal(data.operations.harnesses.length, 1);
  assert.equal(data.operations.previous.total, 105);
});

test("sessions group multi-model daily slices but distinguish same IDs across tools", () => {
  const data = derive([row(), row({ model: "model-b" }), row({ harness: "claude" })]);
  assert.equal(data.operations.totals.sessions, 2);
  assert.equal(data.operations.sessionCount, 2);
  assert.equal(data.operations.sessions[0].total, 210);
  assert.equal(data.operations.sessions[0].models.length, 2);
  assert.equal(data.operations.totals.output, 15, "reasoning must not be counted twice");
});

test("input reuse includes cache writes; cache exclusion does not change the ratio", () => {
  const data = derive([row()]);
  assert.equal(data.operations.totals.reusePct, 80);
  const s = snapshot([row()]);
  s.config.includeCache = false;
  const op = deriveDashboard(s, { today, period: "today" }).operations;
  assert.equal(op.totals.total, 15);
  assert.equal(op.totals.reusePct, 80);
  const empty = derive([row({ tokens: {} })]);
  assert.equal(empty.operations.totals.reusePct, null);
});

test("drivers retain disappeared projects and signed deltas, not just current leaders", () => {
  const data = derive([row(), row({ day: "2026-11-15", project: "/repo/disappeared", tokens: { input: 200 } })]);
  assert.deepEqual(data.operations.drivers.map(({ name, delta }) => ({ name, delta })), [
    { name: "/repo/disappeared", delta: -200 }, { name: "/repo/a", delta: 105 },
  ]);
  assert.equal(data.operations.change.kind, "down");
});

test("incomplete baseline, missing sources, partial scans and unknown metadata remain visible", () => {
  const s = snapshot([row({ project: undefined, model: undefined })]);
  s.sourceStats.codex.status = "missing";
  s.stats.errors = 2;
  s.warnings = ["fixture"];
  s.scan.status = "running";
  const op = deriveDashboard(s, { today, period: "today", filters: { project: "unknown" } }).operations;
  assert.equal(op.totals.total, 105);
  assert.equal(op.baselineCovered, false);
  assert.equal(op.change.kind, "none");
  assert.equal(op.coverage.partial, true);
  assert.equal(op.coverage.sources[0].status, "missing");
  assert.equal(op.coverage.errors, 2);
  assert.equal(op.coverage.unknownProjects, 1);
  assert.equal(op.coverage.unknownModels, 1);
});

test("today and week compare calendar dates without including future rows", () => {
  assert.deepEqual(periodRange("today", { today }).previous, { start: "2026-11-15", end: "2026-11-15" });
  assert.deepEqual(periodRange("week", { today, weekStartsOn: 1 }).previous, { start: "2026-11-09", end: "2026-11-09" });
  const data = derive([row(), row({ day: "2026-11-17" })]);
  assert.equal(data.operations.totals.total, 105);
});

test("large datasets produce bounded detail payloads with accurate totals", () => {
  const rows = Array.from({ length: 12000 }, (_, index) => row({ session: `session-${index}`, project: `/repo/${index % 100}` }));
  const start = performance.now();
  const data = derive(rows);
  assert.equal(data.operations.totals.total, 12000 * 105);
  assert.equal(data.operations.sessionCount, 12000);
  assert.equal(data.operations.sessions.length, 50);
  assert.equal(data.operations.projectCount, 100);
  assert.equal(data.operations.projects.length, 10);
  assert.ok(JSON.stringify(data).length < 512 * 1024);
  assert.ok(performance.now() - start < 5000);
});

test("exports contain selected-period drilldowns and scope caveats without raw transcript data", () => {
  const data = derive([row({ project: "/repo/a|b", text: "PRIVATE TRANSCRIPT" })]);
  const markdown = dashboardMarkdown(data, { now: new Date("2026-11-16T12:00:00Z") });
  assert.match(markdown, /Selected-period usage/);
  assert.match(markdown, /Sessions to inspect/);
  assert.match(markdown, /Data coverage/);
  assert.doesNotMatch(markdown, /PRIVATE TRANSCRIPT/);
  assert.doesNotMatch(JSON.stringify(data.operations), /PRIVATE TRANSCRIPT/);
});

test("fleet prioritizes blocked and completed agents, deduplicates and retains parent relationships", () => {
  const root = { address: "t1", status: "working", space: "a", title: "Parent" };
  const child = { address: "remote/t1", status: "blocked", space: "b", title: "Child" };
  const done = { address: "t3", status: "done", space: "a", title: "Review" };
  const fleet = fleetSnapshot([root, child, root, done], [{ address: "remote/t1", parent: "t1" }], [{ id: "a", name: "Local", machine: null }, { id: "b", name: "Remote", machine: "remote" }], [{ name: "offline", layout: "unavailable" }]);
  assert.equal(fleet.total, 3);
  assert.deepEqual(fleet.rows.map((agent) => agent.address), ["remote/t1", "t3", "t1"]);
  assert.equal(fleet.rows[0].parentName, "Parent");
  assert.equal(fleet.rows[2].children, 1);
  assert.equal(fleet.unavailable.length, 1);
  assert.equal(fleet.rows[0].machine, "remote");
});

test("fleet space filtering uses stable IDs and missing statuses remain unknown", () => {
  const data = fleetSnapshot([{ address: "a", space: "same-name-one" }, { address: "b", space: "same-name-two", status: "working" }], [], [], [], "same-name-one");
  assert.equal(data.total, 1);
  assert.equal(data.counts.unknown, 1);
});

test("unkept child agents are included without counting dead children or looping ancestry", () => {
  const fleet = fleetSnapshot([{ address: "root", space: "a", status: "working", title: "Root" }], [
    { address: "grandchild", parent: "child", state: "live", status: "error" },
    { address: "child", parent: "root", state: "live", status: "working" },
    { address: "dead", parent: "root", state: "exited", status: "working" },
    { address: "cycle-a", parent: "cycle-b", state: "live", status: "working" },
    { address: "cycle-b", parent: "cycle-a", state: "live", status: "working" },
  ], [{ id: "a", name: "Project" }], [], "a");
  assert.equal(fleet.total, 3);
  assert.equal(fleet.counts.blocked, 1);
  assert.equal(fleet.rows[0].address, "grandchild");
  assert.equal(fleet.rows.find((agent) => agent.address === "child").children, 1);
});
