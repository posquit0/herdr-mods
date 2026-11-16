// Synthetic metadata only. Never reads the user's sessions or credentials.
import { dayKey, addDays, DEFAULT_SOURCES } from "./analytics.js";

export const today = dayKey(new Date());
const tools = ["codex", "claude", "pi", "opencode", "antigravity"];
const projects = ["/demo/harbor", "/demo/atlas-api", "/demo/design-system", "/demo/docs"];
const models = ["gpt-5-codex", "claude-sonnet-4-5", "claude-opus-4-1", "gpt-5", "gemini-2.5-pro"];
const rows = [];
for (let offset = 360; offset >= 0; offset--) {
  if (offset % 7 === 5 || offset % 13 === 0) continue;
  for (let n = 0; n < 4; n++) {
    const index = (offset + n) % tools.length;
    const factor = (0.08 + ((offset * 17) % 19) / 8) * (0.7 + n / 5);
    rows.push({
      day: addDays(today, -offset), harness: tools[index], source: tools[index],
      project: projects[n], session: `demo-${offset}-${n}`,
      model: models[index], provider: ["openai", "anthropic", "anthropic", "openai", "google"][index],
      messages: 12 + n * 7, longestTaskMs: (12 + n * 8) * 60000,
      tokens: { input: Math.round(16000 * factor), output: Math.round(4600 * factor), cacheRead: Math.round(58000 * factor), cacheWrite: Math.round(3200 * factor), reasoning: 1200 },
    });
  }
}
export const snapshot = {
  rows, config: { sources: DEFAULT_SOURCES, includeCache: true, palette: "blue", weekStartsOn: 1 },
  generatedAt: new Date().toISOString(), lastScanAt: new Date().toISOString(),
  stats: { errors: 0, files: rows.length, filesRead: 6, unchangedFiles: rows.length - 6 },
  sourceStats: Object.fromEntries(tools.map(tool => [tool, { status: "ok", rows: rows.filter(row => row.harness === tool).length }])),
  warnings: [],
};
export const spaces = () => [{ id: "demo", name: "Harbor", active: true, machine: null, tabs: [] }];
export const terminals = () => [];
export const machines = () => [{ name: null, layout: "ready" }];
export const agents = () => [
  { address: "demo-1", space: "demo", status: "blocked", title: "Review the new auth flow", app: "Claude Code" },
  { address: "demo-2", space: "demo", status: "done", title: "Add regression coverage", app: "Codex" },
  { address: "demo-3", space: "demo", status: "working", title: "Build the settings screen", app: "Pi" },
];
const reset = hours => new Date(Date.now() + hours * 3600000).toISOString();
export const accountEntries = [
  { provider: "Claude", status: "ok", windows: [
    { label: "Session · 5 hours", usedPercent: 28, resetsAt: reset(2.4), scope: "main" },
    { label: "Weekly · 7 days", usedPercent: 43, resetsAt: reset(91), scope: "main" },
  ] },
  { provider: "Codex", status: "ok", plan: "Pro", windows: [
    { label: "Session · 5 hours", usedPercent: 16, resetsAt: reset(3.1), scope: "main" },
    { label: "Weekly · 7 days", usedPercent: 34, resetsAt: reset(116), scope: "main" },
  ] },
  { provider: "Kiro", status: "ok", windows: [
    { label: "Monthly credits", usedPercent: 38, usedCredits: 380, limitCredits: 1000, resetsAt: reset(320), scope: "main" },
  ] },
];
