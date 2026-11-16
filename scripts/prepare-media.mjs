// Creates a disposable fixture bundle; does not install it or control Herdr.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw new Error("Usage: node scripts/prepare-media.mjs <new scratch directory>");
const out = path.resolve(process.argv[2]);
await mkdir(out); // Refuse to reuse an existing bundle.
const mod = path.join(out, "mods/herdr-mods-preview");
await cp(path.join(root, "analytics/mods/analytics"), mod, { recursive: true });
let view = await readFile(path.join(mod, "main.js"), "utf8");
view = view.replace(", agents, terminals, machines } from \"herdr\"", " } from \"herdr\"")
  .replace(", spaces, shared", ", shared")
  .replaceAll("mods/analytics/", "mods/herdr-mods-preview/");
view = 'import { agents, terminals, machines, spaces } from "./fixture.js";\n' + view;
await writeFile(path.join(mod, "analytics-view.js"), view);
await cp(path.join(root, "scripts/media/analytics-preview.js"), path.join(mod, "main.js"));
await cp(path.join(root, "scripts/media/fixture.js"), path.join(mod, "fixture.js"));
await writeFile(path.join(mod, "mod.json"), JSON.stringify({ place: "none", title: "Analytics demo", overlay: { kind: "dialog", width: 0.9, height: 0.85 } }));
await mkdir(path.join(out, "layouts"));
for (const page of ["overview", "history", "accounts", "sessions"]) {
  const layout = { type: "block", content: { mod: "herdr-mods-preview", props: { page } } };
  await writeFile(path.join(out, `layouts/herdr-mods-preview-${page}.json`), JSON.stringify(layout));
}
console.log(`Synthetic Analytics bundle written to ${out}. No app settings changed.`);
