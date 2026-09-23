import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const version = JSON.parse(read("package.json")).version;
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid package.json version");
const targets = {
  "src-tauri/tauri.conf.json": (text) => JSON.stringify({ ...JSON.parse(text), version }, null, 2) + "\n",
  "src-tauri/Cargo.toml": (text) => text.replace(/^(version = ")[^"]+("\s*)$/m, `$1${version}$2`),
  "src-tauri/Cargo.lock": (text) => text.replace(/(name = "armasync"\nversion = ")[^"]+"/, `$1${version}"`),
};
let stale = false;
for (const [name, update] of Object.entries(targets)) {
  const previous = read(name);
  const next = update(previous);
  if (previous === next) continue;
  if (process.argv.includes("--check")) {
    console.error(`${name} differs from package.json; run pnpm version:sync`);
    stale = true;
  } else writeFileSync(fileURLToPath(new URL(name, root)), next);
}
if (stale) process.exitCode = 1;
