// Offline distribution checks. Native rendering still needs a running Herdr.
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
function anchors(markdown) {
  const seen = new Map();
  return new Set([...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) => {
    const base = heading.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  }));
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.filter(e => ![".git", "node_modules", "gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json"].includes(e.name)).map(e => {
    const name = path.join(dir, e.name);
    return e.isDirectory() ? files(name) : [name];
  }));
  return nested.flat();
}
const all = await files(root);
const releases = JSON.parse(await readFile(path.join(root, "release-please-config.json"), "utf8"));
const versions = JSON.parse(await readFile(path.join(root, ".release-please-manifest.json"), "utf8"));
for (const name of ["floatterm", "analytics"]) {
  for (const file of ["README.md", "RECIPE.md", "preview.png", "LICENSE", "VERSION", "CHANGELOG.md", "keys.json", `mods/${name}/main.js`, `mods/${name}/mod.json`, `mods/${name}/LICENSE`]) {
    assert.ok((await stat(path.join(root, name, file))).isFile(), `${name}/${file}`);
  }
  const version = (await readFile(path.join(root, name, "VERSION"), "utf8")).trim();
  assert.equal(version, versions[name], `${name}: release manifest must match VERSION`);
  assert.equal(releases.packages[name].component, name);
  const readme = await readFile(path.join(root, name, "README.md"), "utf8");
  assert.ok(readme.includes(`/releases/download/${name}-v${version}/${name}.zip`), `${name}: stale release download link`);
  const license = await readFile(path.join(root, name, "LICENSE"), "utf8");
  assert.ok(license.includes("Commons Clause") && license.includes("Apache License"));
  assert.equal(await readFile(path.join(root, name, `mods/${name}/LICENSE`), "utf8"), license);
  assert.ok(!all.some(f => f.startsWith(path.join(root, name, "layouts") + path.sep)), `${name} must not ship layouts`);
  const recipe = await readFile(path.join(root, name, "RECIPE.md"), "utf8");
  let last = -1;
  for (const section of ["# ", "## What you see", "## How it behaves", "## Built from", "## Watch out", "## Done when"]) {
    const at = recipe.indexOf(section);
    assert.ok(at > last, `${name}: missing or reordered ${section}`);
    last = at;
  }
  const png = await readFile(path.join(root, name, "preview.png"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.readUInt32BE(16) >= 800 && png.readUInt32BE(20) >= 400, `${name}: preview too small`);
  const keys = JSON.parse(await readFile(path.join(root, name, "keys.json"), "utf8"));
  assert.deepEqual(Object.values(keys.global), [`mod.open:${name}`]);
}
const notices = await readFile(path.join(root, "analytics/THIRD_PARTY_NOTICES.md"), "utf8");
assert.ok(notices.includes("Copyright (c) 2026 Gagan Devagiri") && notices.includes("MIT License"));
assert.equal(await readFile(path.join(root, "analytics/mods/analytics/THIRD_PARTY_NOTICES.md"), "utf8"), notices);
for (const file of all) {
  if (/\.(?:m?js)$/.test(file)) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  if (file.endsWith(".json")) JSON.parse(await readFile(file, "utf8"));
  if (file.endsWith(".md")) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1];
      if (/^(?:https?:|mailto:)/.test(link)) continue;
      const [target, anchor] = link.split("#").map(decodeURIComponent);
      let resolved = target ? path.resolve(path.dirname(file), target) : file;
      const info = await stat(resolved).catch(() => null);
      assert.ok(info, `${path.relative(root, file)}: broken link ${link}`);
      if (info.isDirectory()) resolved = path.join(resolved, "README.md");
      if (anchor) {
        assert.ok(anchors(await readFile(resolved, "utf8")).has(anchor), `${path.relative(root, file)}: missing anchor ${link}`);
      }
    }
  }
}
console.log("Package checks passed: distribution structure, recipes, PNGs, JSON, JS syntax, and local document links/anchors.");
