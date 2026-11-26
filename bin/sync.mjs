#!/usr/bin/env node
// COSHARE_JWT=… node bin/sync.mjs <instance> [--commit <ref>] [--confidentiality <0-3>] [--out <dir>] [--dry-run]
//
// Brings a tenant that already holds the instance to the instance at a commit, its working copy
// by default, and writes only what differs:
// - a page the tenant does not hold is imported, with its links;
// - a page whose markdown differs from the tenant's is written again, values and its whole link
//   set, so a link the page no longer names is removed;
// - an artifact whose page is gone is deleted.
// A page whose markdown the tenant already holds is left alone, and so is the commit it was last
// written at. The schemas must be the tenant's as they are: a changed schema cannot be changed in
// place once published, so the sync stops, says which, and a reload (reset, then load) takes it.
// Writes the bundles it compared to --out, by default <instance>/dist/coshare, so bin/verify.mjs
// can read the tenant against them, and sync-log.json beside them.
import fs from "node:fs";
import path from "node:path";
import { convert, report } from "../lib/convert.mjs";
import { client } from "../lib/coshare.mjs";
import { planArtifacts, schemaDifferences, isLink } from "../lib/sync.mjs";
import { writeArtifact } from "../lib/write.mjs";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const root = args[0];
if (!root || root.startsWith("--")) { console.error("usage: COSHARE_JWT=… node bin/sync.mjs <instance> [--commit <ref>] [--confidentiality <0-3>] [--out <dir>] [--dry-run]"); process.exit(2); }
const level = opt("--confidentiality");
const cs = client({ dry: args.includes("--dry-run") });
const log = { startedAt: new Date().toISOString(), dry: cs.dry, steps: [], failures: [] };
const step = (name, data) => { log.steps.push({ name, ...data }); console.log(`${name}: ${JSON.stringify(data)}`); };
const fail = (what, detail) => { log.failures.push({ what, detail }); console.log(`  FAIL ${what}: ${String(detail).slice(0, 300)}`); };

const r = convert(root, { commit: opt("--commit"), confidentiality: level === null ? null : Number(level) });
const out = opt("--out") ?? path.join(root, "dist", "coshare");
const bundle = (bundleType, items) => ({ bundleType, bundleVersion: 1, exportedAt: Date.now(), itemCount: items.length, items });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "schemas.bundle.json"), JSON.stringify(bundle("SCHEMA", r.schemas), null, 2));
fs.writeFileSync(path.join(out, "artifacts.bundle.json"), JSON.stringify(bundle("ARTIFACT", r.artifacts), null, 2));
fs.writeFileSync(path.join(out, "targets.json"), JSON.stringify(r.targets, null, 2));
fs.writeFileSync(path.join(out, "report.md"), report(r));
step("instance", { name: r.instance, commit: r.commit, schemas: r.counts.schemas, artifacts: r.counts.artifacts, links: r.counts.links });

// The schemas: the tenant's must serve the bundle as they are.
const remote = (await cs.schemas()).filter((s) => s.coshareType.startsWith("cg_"));
const byType = new Map(remote.map((s) => [s.coshareType, s]));
const differences = [];
for (const s of r.schemas) if (!byType.has(s.coshareType)) differences.push(`${s.coshareType} is new`);
for (const s of remote) if (!r.schemas.some((x) => x.coshareType === s.coshareType)) differences.push(`${s.coshareType} is gone`);
for (const s of r.schemas) {
  const live = byType.get(s.coshareType);
  if (!live) continue;
  if (live.coshareState !== "PUBLISHED") { differences.push(`${s.coshareType} is ${live.coshareState}`); continue; }
  const attrs = (await cs.call("GET", `/schemas/${live.coshareUUID}/attributes`)).json?.items ?? [];
  const targetsOf = (a) => (r.targets.find((t) => t.type === s.coshareType && t.attribute === a.coshareName)?.targets ?? [a.coshareRefSchemaType]).map((t) => byType.get(t)?.coshareUUID);
  differences.push(...schemaDifferences(s, attrs, targetsOf));
}
step("schemas", { compared: r.schemas.length, differences: differences.length });
if (differences.length) {
  for (const d of differences.slice(0, 40)) console.log(`  ${d}`);
  console.log("The schemas changed. A published schema cannot change in place: reload with bin/reset.mjs, then bin/load.mjs.");
  fs.writeFileSync(path.join(out, "sync-log.json"), JSON.stringify({ ...log, differences }, null, 2));
  process.exit(1);
}

// The artifacts the tenant holds, with their markdown.
const lists = (await cs.graphql("{ coshareSchemas(first: 500) { items { type listField } } }"))?.data?.coshareSchemas?.items ?? [];
const live = new Map();
for (const s of remote) {
  const field = lists.find((x) => x.type === s.coshareType)?.listField;
  if (!field) continue;
  for (const a of (await cs.graphql(`{ ${field}(first: 5000) { coshareUUID markdown } }`))?.data?.[field] ?? []) live.set(a.coshareUUID, { type: s.coshareType, markdown: a.markdown });
}
const plan = planArtifacts(r.artifacts, live);
step("plan", { added: plan.added.length, changed: plan.changed.length, removed: plan.removed.length, unchanged: plan.unchanged.length, pages: [...plan.added, ...plan.changed].map((a) => a.attributes.address).slice(0, 20) });

// Added pages: imported first, so a changed page's link can point at one.
const exists = new Set(live.keys());
for (let i = 0; i < plan.added.length; i += 50) {
  const chunk = plan.added.slice(i, i + 50).map((a) => ({ ...a, coshareSchemaUUID: byType.get(a.coshareType).coshareUUID, attributes: Object.fromEntries(Object.entries(a.attributes).filter(([, v]) => !isLink(v))) }));
  const res = await cs.importBundle("artifacts", "ARTIFACT", chunk);
  if (res.dry) { for (const a of chunk) exists.add(a.coshareUUID); continue; }
  for (const it of res.json?.items ?? []) if (it.status === "SUCCESS") exists.add(chunk[it.index].coshareUUID); else fail(`import ${chunk[it.index]?.attributes.address}`, it.error);
}
// Removed pages leave before links are written, so no link is written to an artifact about to go.
for (const a of plan.removed) {
  const res = await cs.write("DELETE", `/schemas/${byType.get(a.coshareType).coshareTypeUUID}/artifacts/${a.coshareUUID}?force=true`);
  if (res.ok) exists.delete(a.coshareUUID); else fail(`delete ${a.coshareType} ${a.coshareUUID}`, res.text);
}

// Values and links, for every added and changed page.
const schemaOfType = new Map(r.schemas.map((s) => [s.coshareType, s]));
const t = { written: 0, linked: 0, props: 0, waiting: 0, missing: 0, extra: 0 };
for (const a of [...plan.added, ...plan.changed]) {
  if (!exists.has(a.coshareUUID)) continue;
  const refAttrs = schemaOfType.get(a.coshareType).attributes.filter((x) => x.coshareType === "REFERENCE");
  const w = await writeArtifact(cs, { typeUuid: byType.get(a.coshareType).coshareTypeUUID, artifact: a, refAttrs, exists: (id) => exists.has(id), clear: true });
  for (const f of w.failures) fail("write", f);
  for (const m of w.missing) fail("readback", `${m}: link not there after the PUT`);
  for (const x of w.extra) fail("readback", `${x}: link still there after the PUT`);
  if (!w.failures.some((f) => f.startsWith("PUT"))) t.written++;
  t.linked += w.linked; t.props += w.props; t.waiting += w.waiting; t.missing += w.missing.length; t.extra += w.extra.length;
}
step("written", { artifacts: t.written, links: t.linked, propertiesPatched: t.props, waitingForTargets: t.waiting, missingOnReadback: t.missing, extraOnReadback: t.extra, deleted: plan.removed.length });

log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, cs.dry ? "sync-plan.json" : "sync-log.json"), JSON.stringify(log, null, 2));
console.log(`${log.failures.length} failure(s)`);
process.exitCode = log.failures.length ? 1 : 0;
