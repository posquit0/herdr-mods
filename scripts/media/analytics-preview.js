// Runs the real view against synthetic data. Not part of either installable mod.
import Analytics from "./analytics-view.js";
import { compactDashboard, deriveDashboard } from "./analytics.js";
import { AccountState } from "./account-state.js";
import { snapshot, today, accountEntries } from "./fixture.js";
import { props } from "herdr";

export default class Preview extends Analytics {
  resolveRuntime() {}
  init(p, cx) {
    super.init(p, cx);
    this.snapshot = snapshot;
    this.period = "month";
    this.page = props()?.page ?? "overview";
    this.selectedDay = snapshot.rows.at(-1).day;
    this.runtimeReady = true;
    let state = { localOnly: false, entries: accountEntries, updatedAt: Date.now(), nextRefreshAt: Date.now() + 300000 };
    this.accounts = new AccountState({
      shared: () => state, setShared: (_key, next) => { state = next; },
      now: Date.now, ready: () => true,
      collect: async () => ({ code: 0, stdout: JSON.stringify({ version: 1, entries: accountEntries }) }),
    });
    this.scheduleDashboard(cx);
  }
  scheduleDashboard(cx) {
    this.dashboard = compactDashboard(deriveDashboard(snapshot, {
      today, period: this.period, filters: this.filters, selectedDay: this.selectedDay,
      year: this.year, heatmapMode: this.heatmapMode,
    }));
    cx.notify();
  }
  dashboardCurrent() { return true; }
  refresh(cx) { this.scheduleDashboard(cx); }
  exportMarkdown() {}
  saveConfig() {}
}
