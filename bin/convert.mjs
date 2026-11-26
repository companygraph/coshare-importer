#!/usr/bin/env node
// node bin/convert.mjs <instance> [--out <dir>] [--only <type,type>] [--confidentiality <0-3>]
// Writes schemas.bundle.json, artifacts.bundle.json, targets.json and report.md, by default into
// <instance>/dist/coshare. Reads the instance only; nothing is sent anywhere. --confidentiality is
// the level every attribute takes, for where the instance is kept: 0 public, 1 internal,
// 2 confidential, 3 strictly confidential; without it, CoShare shows confidentiality undecided.
import fs from "node:fs";
import path from "node:path";
import { convert, report } from "../lib/convert.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const root = args[0];
if (!root || root.startsWith("--")) { console.error("usage: node bin/convert.mjs <instance> [--out <dir>] [--only <type,type>] [--confidentiality <0-3>]"); process.exit(2); }
const out = opt("--out") ?? path.join(root, "dist", "coshare");
const level = opt("--confidentiality");
const r = convert(root, { only: opt("--only")?.split(",") ?? null, confidentiality: level === null ? null : Number(level) });

const bundle = (bundleType, items) => ({ bundleType, bundleVersion: 1, exportedAt: Date.now(), itemCount: items.length, items });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "schemas.bundle.json"), JSON.stringify(bundle("SCHEMA", r.schemas), null, 2));
fs.writeFileSync(path.join(out, "artifacts.bundle.json"), JSON.stringify(bundle("ARTIFACT", r.artifacts), null, 2));
fs.writeFileSync(path.join(out, "targets.json"), JSON.stringify(r.targets, null, 2));
fs.writeFileSync(path.join(out, "report.md"), report(r));
const c = r.counts;
console.log(`wrote ${out}: ${c.schemas} schemas, ${c.artifacts} artifacts, ${c.links} links (${c.merged} rows merged into a link to the same target), ${r.targets.length} multi-target references, ${r.losses.length} loose ends`);
