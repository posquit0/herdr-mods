// Run: node --experimental-vm-modules --test tests/herdr-floatterm.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../floatterm/mods/floatterm/main.js", import.meta.url), "utf8");

async function launcher(entries, options = {}) {
  const calls = [];
  const tasks = [];
  const overlays = [];
  const controllers = [];
  const timers = [];
  const inputEvents = {};
  const scrolled = [];
  let inputValue = "";
  let focus = options.focus === null ? null : { space: "local", tab: "tab-a", terminal: "origin", cwd: "/work/project", ...options.focus };
  const live = options.live ?? [];
  const api = {
    home: () => "/home/test",
    appHome: () => "/config/herdr-app",
    props: () => ({ overlay: options.check ? undefined : "menu", ...options.props }),
    focused: () => focus,
    spaces: () => options.spaces ?? ["local", "other"].map(id => ({ id, machine: options.remote ? "remote" : null, tabs: [{ id: "tab-a" }, { id: "tab-b" }] })),
    terminals: () => live,
    readTextFile: async () => options.text !== undefined ? options.text : JSON.stringify(entries),
    hc: async (args) => {
      calls.push(["hc", args]);
      if (options.fail) return { code: 1, stderr: "test failure", stdout: "" };
      if (options.removed && args[0] === "kill") {
        return { code: 3, stderr: JSON.stringify({ error: { kind: "not_found", message: `${args[1]} was removed` } }), stdout: "" };
      }
      if (args[0] === "run") {
        const address = live.length ? `new-terminal-${live.length}` : "new-terminal";
        const labels = Object.fromEntries(args.flatMap((arg, i) => arg === "--label" ? [args[i + 1].split(/=(.*)/s).slice(0, 2)] : []));
        live.push({ address, labels, state: "live" });
        if (options.switchOnRun) focus = { ...focus, ...options.switchOnRun };
        return { code: 0, stdout: JSON.stringify({ address }), stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    openOverlay: (spec) => { if (spec.props?.restorer) { controllers.push(spec); return `controller-${controllers.length}`; } overlays.push(spec); calls.push(["openOverlay", spec.layout.children[2].content.terminal]); return "terminal-overlay"; },
    closeOverlay: (id) => calls.push(["close", id]),
    run: (...args) => calls.push(["run", ...args]),
    notify: (message) => calls.push(["notify", message]),
    theme: () => ({}),
  };
  const context = vm.createContext();
  const module = new vm.SourceTextModule(source, { context });
  await module.link(async (name) => {
    const exports = name === "herdr" ? api : name === "gpui-kit" ? { View: class {}, div: () => ({ size_full() { return this; }, w() { return this; }, h() { return this; } }) } : {
      v_flex: () => {}, h_flex: () => {}, Input: {},
      InputState: { new: () => ({
        on: (event, handler) => { inputEvents[event] = handler; },
        value: () => inputValue,
        focus() {},
      }) },
      ScrollHandle: { new: () => ({ scroll_to_item: index => scrolled.push(index) }) },
    };
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const cx = {
    focus_handle: () => ({ focus() {} }),
    timer: {
      after(_ms, cb) { timers.push(cb); },
      every(_ms, cb) { queueMicrotask(cb); return { cancel() {} }; },
    },
    spawn: (fn) => tasks.push(fn(cx)),
    notify() {},
    stop_propagation() {},
  };
  const view = new module.namespace.default();
  view.init({}, cx);
  await Promise.all(tasks);
  const previousProps = options.props;
  options.props = { restorer: true, overlay: controllers.length ? `controller-${controllers.length}` : "layout-controller" };
  const controller = new module.namespace.default();
  controller.init({}, cx);
  options.props = previousProps;
  return {
    view, calls, overlays, scrolled, controllers, controller,
    search(text) { if (!view.searching) view.key({ keystroke: "/" }, cx); inputValue = text; inputEvents.change({}, cx); },
    async key(keystroke) { view.key({ keystroke }, cx); await Promise.all(tasks); },
    async submit() { inputEvents.submit({}, cx); await Promise.all(tasks); },
    render(copy = view) { copy.render(cx); },
    flushTimers() { while (timers.length) timers.shift()(cx); },
    tickRestorers() { controller.render(cx); while (timers.length) timers.shift()(cx); },
    async mount(props) {
      const previous = options.props;
      options.props = props;
      const copy = new module.namespace.default();
      copy.init({}, cx);
      options.props = previous;
      await Promise.all(tasks);
      return copy;
    },
    moveFocus(next = { cwd: "/wrong/directory" }) { focus = { ...focus, ...next }; },
    async pick(index = 0, from) {
      if (from !== undefined) view.from = from;
      view.pick(view.programs[index], cx);
      await Promise.all(tasks);
    },
  };
}

const entry = { id: "scratch", key: "s" };
const live = [{ address: "existing", labels: { popup: "scratch", "floatterm.scope": "tab:local:tab-a" }, state: "live" }];
const plain = (value) => JSON.parse(JSON.stringify(value));

test("shell defaults capture the original directory before focus changes", async () => {
  const app = await launcher([entry]);
  app.moveFocus();
  await app.pick();
  const args = app.calls.find(([kind]) => kind === "hc")[1];
  assert.equal(args[args.indexOf("--cwd") + 1], "/work/project");
  assert.deepEqual(plain(args.slice(-3)), ["--", "/bin/zsh", "-l"]);
  assert.ok(!args.includes("--keep"));
  assert.deepEqual(plain(app.calls.slice(-2)), [["close", "menu"], ["openOverlay", "new-terminal"]]);
});

test("programs retain shell arguments and persistent mode enables recovery", async () => {
  const command = "printf '%s\\n' 'two words'; exec lazygit";
  const app = await launcher([{ ...entry, command, cwd: "~/dot files", session: "persistent" }]);
  await app.pick();
  const args = app.calls[0][1];
  assert.deepEqual(plain(args.slice(-3)), ["/bin/zsh", "-lic", command]);
  assert.equal(args[args.indexOf("--cwd") + 1], "/home/test/dot files");
  assert.ok(args.includes("--keep"));
});

test("directories support absolute, relative, home and remote fallback", async () => {
  for (const [cwd, remote, expected] of [["/tmp", false, "/tmp"], ["../other", false, "/work/project/../other"], ["~", false, "/home/test"], [undefined, true, "/home/test"]]) {
    const app = await launcher([{ ...entry, cwd }], { remote });
    await app.pick();
    const args = app.calls[0][1];
    assert.equal(args[args.indexOf("--cwd") + 1], expected);
  }
});

test("persistent sessions reuse stable IDs after key and name changes", async () => {
  for (const from of ["origin", "existing"]) {
    const app = await launcher([{ ...entry, key: "x", name: "renamed", session: "persistent" }], { live });
    await app.pick(0, from);
    assert.ok(!app.calls.some(([kind]) => kind === "hc"));
    assert.deepEqual(plain(app.calls), from === "existing"
      ? [["close", "menu"], ["run", "overlay.close"]]
      : [["close", "menu"], ["openOverlay", "existing"]]);
  }
});

test("hidden ephemeral sessions reopen without being killed", async () => {
  const app = await launcher([entry], { live });
  await app.pick();
  assert.deepEqual(plain(app.calls), [["close", "menu"], ["openOverlay", "existing"]]);
});

test("ephemeral sessions end when selected from inside their popup", async () => {
  const app = await launcher([entry], { live });
  await app.pick(0, "existing");
  assert.deepEqual(plain(app.calls), [["hc", ["kill", "existing"]], ["close", "menu"]]);
});

test("killing an automatically removed terminal does not show a false error", async () => {
  const app = await launcher([entry], { live, removed: true });
  await app.pick(0, "existing");
  assert.deepEqual(plain(app.calls), [["hc", ["kill", "existing"]], ["close", "menu"]]);
});

test("invalid configurations show an error without loading partial entries", async () => {
  for (const text of [null, "{", "{}", JSON.stringify([entry, entry]), JSON.stringify([entry, { ...entry, id: "other" }]), JSON.stringify([{ ...entry, session: "persistant" }]), JSON.stringify([{ ...entry, command: [] }]), JSON.stringify([{ ...entry, cwd: "" }])]) {
    const app = await launcher([], { text });
    assert.equal(app.view.programs.length, 0);
    assert.match(app.view.message, /^config\.json:/);
    assert.deepEqual(app.calls, []);
  }
});

test("check mode never starts a terminal; large menus retain all entries", async () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ id: `entry-${i}`, key: `f${i + 1}` }));
  const app = await launcher(entries, { check: true });
  assert.equal(app.view.programs.length, 40);
  await app.pick();
  assert.deepEqual(app.calls, []);
});

test("the search key cannot silently shadow a configured launcher entry", async () => {
  const app = await launcher([entry, { ...entry, id: "search-conflict", key: "/" }]);
  assert.match(app.view.message, /reserved for search/);
  assert.equal(app.view.programs.length, 0);
  await app.key("/");
  assert.ok(!app.calls.some(([kind]) => kind === "hc"));
});

test("launch and kill failures are reported", async () => {
  for (const terminals of [[], live]) {
    const app = await launcher([entry], { live: terminals, fail: true });
    await app.pick(0, "existing");
    assert.match(app.calls.find(([kind]) => kind === "notify")[1].body, /test failure/);
    assert.ok(!app.calls.some(([kind]) => kind === "run" || kind === "openOverlay"));
  }
});

test("dismissing the menu restores the existing popup without killing it", async () => {
  const app = await launcher([entry], { live });
  app.view.from = "existing";
  await app.view.close();
  assert.deepEqual(plain(app.calls), [["run", "terminal.peek", { terminal: "existing" }]]);
});

test("default scope isolates tabs and spaces and reuses the original tab's session", async () => {
  const shared = [];
  for (const focus of [{}, { tab: "tab-b" }, { space: "other" }]) {
    const app = await launcher([entry], { live: shared, focus });
    await app.pick();
  }
  assert.equal(shared.length, 3);
  assert.equal(new Set(shared.map((t) => t.labels["floatterm.scope"])).size, 3);
  const original = await launcher([entry], { live: shared });
  await original.pick();
  assert.deepEqual(plain(original.calls), [["close", "menu"], ["openOverlay", shared[0].address]]);
});

test("space scope shares between its tabs but isolates other spaces", async () => {
  const shared = [];
  const config = [{ ...entry, scope: "space", session: "persistent" }];
  for (const focus of [{}, { tab: "tab-b" }, { space: "other" }]) {
    const app = await launcher(config, { live: shared, focus });
    await app.pick();
  }
  assert.equal(shared.length, 2);
  assert.deepEqual(shared.map((t) => t.labels["floatterm.scope"]), ["space:local", "space:other"]);
});

test("global scope can reuse legacy sessions while tab scope leaves them alone", async () => {
  const legacy = [{ address: "legacy", labels: { popup: "scratch" }, state: "live" }];
  const global = await launcher([{ ...entry, scope: "global" }], { live: legacy, focus: { space: "other" } });
  await global.pick();
  assert.deepEqual(plain(global.calls), [["close", "menu"], ["openOverlay", "legacy"]]);
  const scoped = await launcher([entry], { live: legacy });
  await scoped.pick();
  assert.equal(legacy.length, 2);
  assert.ok(!scoped.calls.some(([kind, args]) => kind === "hc" && args[0] === "kill"));
});

test("invalid scope and missing context cannot create a shared session accidentally", async () => {
  const invalid = await launcher([{ ...entry, scope: "tabs" }]);
  assert.match(invalid.view.message, /scope/);
  assert.equal(invalid.view.programs.length, 0);
  const missing = await launcher([entry], { focus: null });
  await missing.pick();
  assert.ok(!missing.calls.some(([kind]) => kind === "hc"));
  assert.match(missing.calls.find(([kind]) => kind === "notify")[1].body, /tab/i);
});

test("a launch finishing after a tab switch stays in its originating tab", async () => {
  const shared = [];
  const app = await launcher([entry], { live: shared, switchOnRun: { tab: "tab-b" } });
  await app.pick();
  assert.equal(shared[0].labels["floatterm.scope"], "tab:local:tab-a");
  assert.ok(!app.calls.some(([kind]) => kind === "run" || kind === "openOverlay"));
});

test("closing a menu during navigation does not restore the previous tab's popup", async () => {
  const app = await launcher([entry], { live });
  app.view.from = "existing";
  app.moveFocus({ tab: "tab-b" });
  await app.view.close();
  assert.deepEqual(app.calls, []);
});

test("floating layouts carry their owning scope and keep the standard peek controls", async () => {
  const app = await launcher([entry]);
  await app.pick();
  const blocks = app.overlays[0].layout.children;
  assert.equal(blocks[0].content.mod, "floatterm");
  assert.equal(blocks[0].content.props.scopeGuard.scope, "tab");
  assert.equal(blocks[0].content.props.scopeGuard.context.tab, "tab-a");
  assert.equal(blocks[1].content.mod, "peek");
  assert.equal(blocks[1].content.props.terminal, blocks[2].content.terminal);
});

test("scope guards hide only their own overlay when leaving the scope", async () => {
  for (const [scope, destination, shouldHide] of [
    ["tab", { tab: "tab-b" }, true],
    ["space", { tab: "tab-b" }, false],
    ["space", { space: "other" }, true],
    ["global", { space: "other" }, false],
  ]) {
    const app = await launcher([], { props: { scopeGuard: { scope, terminal: "existing", context: { space: "local", tab: "tab-a" } } } });
    app.moveFocus(destination);
    app.render();
    assert.deepEqual(app.calls, []); // no mutation during render
    app.flushTimers();
    assert.deepEqual(app.calls, shouldHide ? [["close", "menu"]] : []);
    app.render();
    app.flushTimers();
    assert.equal(app.calls.length, shouldHide ? 1 : 0);
  }
});

test("menu cancellation restores the scoped overlay and stale cleanup cannot remove its replacement", async () => {
  const app = await launcher([entry], { live });
  const guard = await app.mount({ overlay: "old-overlay", scopeGuard: { scope: "tab", terminal: "existing", context: { space: "local", tab: "tab-a" } } });
  app.view.from = "existing";
  await app.view.close();
  assert.deepEqual(plain(app.calls), [["close", "old-overlay"], ["openOverlay", "existing"]]);
  await guard.close();
  app.calls.length = 0;
  await app.view.close();
  assert.deepEqual(plain(app.calls), [["close", "terminal-overlay"], ["openOverlay", "existing"]]);
  assert.equal(app.overlays[1].layout.children[0].content.props.scopeGuard.scope, "tab");
});

const guardProps = (scope = "tab", terminal = "existing") => ({
  overlay: `overlay-${terminal}`,
  scopeGuard: { scope, terminal, context: { space: "local", tab: "tab-a" } },
});

test("navigation-hidden popups restore their live session when returning to the scope", async () => {
  for (const scope of ["tab", "space"]) {
    const app = await launcher([], { props: guardProps(scope), live });
    app.moveFocus({ space: "other", tab: "tab-b" });
    app.render();
    app.flushTimers();
    await app.view.close();
    app.calls.length = 0;
    app.tickRestorers();
    assert.deepEqual(app.calls, []);
    app.moveFocus({ space: "local", tab: scope === "tab" ? "tab-a" : "tab-b" });
    app.tickRestorers();
    assert.deepEqual(plain(app.calls), [["openOverlay", "existing"]]);
  }
});

test("manually closed popups do not restore on navigation", async () => {
  const app = await launcher([], { props: guardProps(), live });
  await app.view.close();
  app.moveFocus({ tab: "tab-b" });
  app.tickRestorers();
  app.moveFocus({ tab: "tab-a" });
  app.tickRestorers();
  assert.deepEqual(app.calls, []);
});

test("returning before the deferred hide keeps the popup open", async () => {
  const app = await launcher([], { props: guardProps(), live });
  app.moveFocus({ tab: "tab-b" });
  app.render();
  app.moveFocus({ tab: "tab-a" });
  app.flushTimers();
  assert.deepEqual(app.calls, []);
});

test("restoration drops ended terminals and deleted owner tabs", async () => {
  for (const removed of ["terminal", "tab"]) {
    const sessions = live.map(t => ({ ...t }));
    const options = { props: guardProps(), live: sessions };
    const app = await launcher([], options);
    app.moveFocus({ tab: "tab-b" });
    app.render();
    app.flushTimers();
    await app.view.close();
    app.calls.length = 0;
    if (removed === "terminal") sessions.length = 0;
    else options.spaces = [{ id: "local", tabs: [{ id: "tab-b" }] }];
    app.tickRestorers();
    app.moveFocus({ tab: "tab-a" });
    app.tickRestorers();
    assert.deepEqual(app.calls, []);
  }
});

test("restoration waits for the departing overlay to finish returning focus", async () => {
  const sessions = [...live, { address: "second", state: "live" }];
  const app = await launcher([], { props: guardProps(), live: sessions });
  app.moveFocus({ tab: "tab-b" });
  app.render();
  app.flushTimers();
  await app.view.close();
  const nextProps = guardProps("tab", "second");
  nextProps.scopeGuard.context.tab = "tab-b";
  const second = await app.mount(nextProps);
  app.moveFocus({ tab: "tab-a" });
  app.render(second);
  app.flushTimers();
  app.calls.length = 0;
  app.tickRestorers();
  assert.deepEqual(app.calls, []);
  await second.close();
  app.tickRestorers();
  assert.deepEqual(plain(app.calls), [["openOverlay", "existing"]]);
});

test("navigation closing an overlay before its next render still remembers it", async () => {
  const app = await launcher([], { props: guardProps(), live });
  app.moveFocus({ tab: "tab-b" });
  await app.view.close();
  app.tickRestorers();
  assert.deepEqual(app.calls, []);
  app.moveFocus({ tab: "tab-a" });
  app.tickRestorers();
  assert.deepEqual(plain(app.calls), [["openOverlay", "existing"]]);
});

test("fuzzy search matches names, IDs, commands and configured key aliases", async () => {
  const app = await launcher([
    { id: "git", name: "Repository", key: "g", command: "lazygit" },
    { id: "kubernetes", name: "Cluster", key: "k", command: "k9s" },
  ]);
  for (const query of ["LZG", "rps", "git", "g", "repo lzg"]) {
    app.search(query);
    assert.deepEqual(plain(app.view.rows().map(p => p.id)), ["git"]);
  }
  app.search("kbr");
  assert.deepEqual(plain(app.view.rows().map(p => p.id)), ["kubernetes"]);
  app.search("   ");
  assert.equal(app.view.rows().length, 2);
  assert.equal(app.calls.length, 0, "typing a configured key must not launch anything");
});

test("fuzzy ranking prefers exact, prefix and contiguous matches over subsequences", async () => {
  const app = await launcher([
    { id: "gapped", name: "little zealous goose", key: "1" },
    { id: "contains", name: "run lzg", key: "2" },
    { id: "prefix", name: "lzg tool", key: "3" },
    { id: "exact", name: "lzg", key: "4" },
  ]);
  app.search("LZG");
  assert.deepEqual(plain(app.view.rows().map(p => p.id)), ["exact", "prefix", "contains", "gapped"]);
});

test("arrow navigation wraps, scrolls and Enter launches the selected filtered entry", async () => {
  const app = await launcher([
    { id: "first", key: "f", command: "first" },
    { id: "second", key: "s", command: "second" },
    { id: "third", key: "t", command: "third" },
  ]);
  app.key("up");
  assert.equal(app.view.selected, 2);
  app.key("down");
  assert.equal(app.view.selected, 0);
  app.key("down");
  assert.equal(app.scrolled.at(-1), 1);
  app.search("thrd");
  assert.equal(app.view.selected, 0);
  assert.equal(app.scrolled.at(-1), 0);
  await app.submit();
  assert.equal(app.calls.find(([kind]) => kind === "hc")[1].at(-1), "third");
});

test("empty results ignore arrows and Enter and recover when the query clears", async () => {
  const app = await launcher([entry]);
  app.search("no-match");
  app.key("down");
  app.key("up");
  await app.submit();
  assert.equal(app.view.selected, 0);
  assert.deepEqual(app.calls, []);
  app.search("");
  await app.submit();
  assert.ok(app.calls.some(([kind]) => kind === "hc"));
});

test("native input changes support pasted Unicode queries without manual key decoding", async () => {
  const app = await launcher([{ id: "shell", key: "s", name: "작업 터미널" }]);
  app.search("작터");
  assert.equal(app.view.rows().length, 1);
  app.key("s");
  assert.deepEqual(app.calls, []);
});

test("configured shortcuts still launch directly until slash starts search", async () => {
  const config = [{ id: "git", key: "g", command: "lazygit" }];
  const direct = await launcher(config);
  assert.equal(direct.view.searching, false);
  await direct.key("g");
  assert.equal(direct.calls.find(([kind]) => kind === "hc")[1].at(-1), "lazygit");
  const search = await launcher(config);
  await search.key("/");
  assert.equal(search.view.searching, true);
  await search.key("g");
  assert.deepEqual(search.calls, []);
  search.search("lzg");
  await search.submit();
  assert.equal(search.calls.find(([kind]) => kind === "hc")[1].at(-1), "lazygit");
});

test("menus share one invisible controller and recreate it after it closes", async () => {
  const app = await launcher([entry]);
  assert.equal(app.controllers.length, 1);
  assert.equal(app.controllers[0].kind, "window");
  assert.equal(app.controllers[0].frame, "none");
  await app.view.close();
  const secondMenu = await app.mount({ overlay: "second-menu" });
  assert.equal(app.controllers.length, 1);
  await secondMenu.close();
  await app.controller.close();
  await app.mount({ overlay: "third-menu" });
  assert.equal(app.controllers.length, 2);
  await app.controller.close(); // late cleanup from the old controller
  await app.mount({ overlay: "fourth-menu" });
  assert.equal(app.controllers.length, 2);
});

test("check and guard instances do not create controller windows", async () => {
  const check = await launcher([entry], { check: true });
  const guard = await launcher([], { props: guardProps(), live });
  assert.equal(check.controllers.length, 0);
  assert.equal(guard.controllers.length, 0);
});

test("restoration waits until the launcher menu closes", async () => {
  const app = await launcher([], { props: guardProps(), live });
  app.moveFocus({ tab: "tab-b" });
  await app.view.close();
  app.moveFocus({ tab: "tab-a", terminal: "origin" });
  const menu = await app.mount({ overlay: "menu" });
  app.tickRestorers();
  assert.equal(app.overlays.length, 0);
  await menu.close();
  app.tickRestorers();
  assert.deepEqual(plain(app.calls), [["openOverlay", "existing"]]);
});
