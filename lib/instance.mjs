// An instance as meta-model's own reader takes it: core and the packs its manifest names, keyed
// as parseSchemas reads them, and every page under model/.
import fs from "node:fs";
import os from "node:os";
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
 * Everything is read into memory here, so a caller never touches the folder again.
 * @param {string} root the instance's folder: .companygraph/manifest.json beside model/
 * @param {{ commit?: string | null }} [options] a commit, tag or branch of the instance's
 *   repository to read instead of its working copy; it is read with git archive into a
 *   temporary folder, which is removed before this returns, so the working copy is not touched
 */
export function load(root, { commit = null } = {}) {
  let dir = root, sha = git(root, "rev-parse", "--short", "HEAD");
  if (commit) {
    sha = git(root, "rev-parse", "--short", `${commit}^{commit}`);
    if (!sha) throw new Error(`${root} has no commit ${commit}`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "coshare-importer-"));
    execFileSync("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", root, sha, dir], { stdio: ["ignore", "ignore", "pipe"] });
  }
  try {
    const manifest = readJson(path.join(dir, ".companygraph", "manifest.json"));
    if (!manifest) throw new Error(`${root}${commit ? ` at ${commit}` : ""} is not an instance: it has no .companygraph/manifest.json`);
    const units = manifest.units ?? "meta";
    const schemas = walk(path.join(dir, units, "core"));
    for (const pack of manifest.packs ?? []) for (const [f, t] of walk(path.join(dir, units, pack))) schemas.set(`${pack}/${f}`, t);
    const files = walk(path.join(dir, "model"));
    // Each unit, core or a pack, carries its version in its own manifest.json.
    const versions = new Map(["core", ...(manifest.packs ?? [])].map((u) => [u, readJson(path.join(dir, units, u, "manifest.json"))?.version ?? null]));
    // The instance's name: its GitHub repository where it has one, else its folder.
    const remote = git(root, "remote", "get-url", "origin");
    const name = remote?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? path.basename(path.resolve(root));
    return {
      manifest, schemas, files, name, commit: sha,
      unitVersion: (unit) => versions.get(unit) ?? null,
      vocabulary: parseSchemas(schemas),
      constraints: constraintsOf(schemas),
      graph: parseInstance(files, { schemas }),
    };
  } finally {
    if (dir !== root) fs.rmSync(dir, { recursive: true, force: true });
  }
}
