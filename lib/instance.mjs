// An instance as meta-model's own reader takes it: core and the packs its manifest names, keyed
// as parseSchemas reads them, and every page under model/.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { parseSchemas, constraintsOf, parseInstance } from "@companygraph/meta-model/instance";

const walk = (dir, base = dir, out = new Map()) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else if (/\.(md|json)$/.test(e.name)) out.set(path.relative(base, p), fs.readFileSync(p, "utf8"));
  }
  return out;
};

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const git = (root, ...args) => { try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };

/** The version of @companygraph/meta-model this importer reads with. */
export const parserVersion = () => {
  // package.json is not among the package's exports, so it is found from an entry that is.
  let dir = path.dirname(createRequire(import.meta.url).resolve("@companygraph/meta-model/instance"));
  for (; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const pkg = readJson(path.join(dir, "package.json"));
    if (pkg?.name === "@companygraph/meta-model") return pkg.version;
  }
  return null;
};

/**
 * @param {string} root the instance's folder: .companygraph/manifest.json beside model/
 */
export function load(root) {
  const manifest = readJson(path.join(root, ".companygraph", "manifest.json"));
  if (!manifest) throw new Error(`${root} is not an instance: it has no .companygraph/manifest.json`);
  const units = manifest.units ?? "meta";
  const schemas = walk(path.join(root, units, "core"));
  for (const pack of manifest.packs ?? []) for (const [f, t] of walk(path.join(root, units, pack))) schemas.set(`${pack}/${f}`, t);
  const files = walk(path.join(root, "model"));
  // Each unit, core or a pack, carries its version in its own manifest.json.
  const unitVersion = (unit) => readJson(path.join(root, units, unit, "manifest.json"))?.version ?? null;
  // The instance's name: its GitHub repository where it has one, else its folder.
  const remote = git(root, "remote", "get-url", "origin");
  const name = remote?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? path.basename(path.resolve(root));
  return {
    manifest, schemas, files, unitVersion, name,
    commit: git(root, "rev-parse", "--short", "HEAD"),
    vocabulary: parseSchemas(schemas),
    constraints: constraintsOf(schemas),
    graph: parseInstance(files, { schemas }),
  };
}
