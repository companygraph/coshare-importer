#!/usr/bin/env node
// COSHARE_JWT=… node bin/sync.mjs <instance> [--commit <ref>] [--confidentiality <0-3>] [--out <dir>] [--dry-run]
//
// Brings a tenant that already holds the instance to the instance at a commit, its working copy
// by default, and writes only what differs:
// - a page the tenant does not hold is imported, with its links;
// - a page whose digest differs from the tenant's is written again with a PUT, its values and
//   its whole link set, so a link the page no longer names is removed; the links other artifacts
//   have to it stay;
// - an artifact whose page is gone is deleted.
// A page whose digest the tenant already holds is left alone, and so is the commit it was last
// written at. Before the pages, the schemas: a type the tenant lacks is imported and published; a
// type whose schema changed takes a new version, since a published schema cannot change in place.
// The version is bumped by the segment the unit's version moved, or by a patch where only the
// mapping changed; its attributes are changed in the draft, it is published over the previous
// version, which CoShare deprecates, and the type's artifacts are migrated to it one by one. The previous version is left
// deprecated: archiving it removes the artifacts migrated from it (seen 2026-11-28). Every page of
// such a type is then written again. A type the instance no longer has, or one with a
// draft or a review left over, stops the sync.
// Writes the bundles it compared to --out, by default <instance>/dist/coshare, so bin/verify.mjs
// can read the tenant against them, and sync-log.json beside them.
import fs from "node:fs";
import path from "node:path";
import { convert, report } from "../lib/convert.mjs";
import { client } from "../lib/coshare.mjs";
import { planArtifacts, attributePlan, groupPlan, schemaDifferences, bumpOf, withTargets, addressOf } from "../lib/sync.mjs";
import { flatAttributes } from "../lib/convert.mjs";
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
fs.rmSync(path.join(out, "targets.json"), { force: true }); // written by importers before 2026-11-28
fs.writeFileSync(path.join(out, "report.md"), report(r));
step("instance", { name: r.instance, commit: r.commit, schemas: r.counts.schemas, artifacts: r.counts.artifacts, links: r.counts.links });

// The schemas: compared by type, each with the tenant's current, published version of it.
const lists = async () => (await cs.graphql("{ coshareSchemas(first: 500) { items { type listField } } }"))?.data?.coshareSchemas?.items ?? [];
const idsOf = async (type, fields = "coshareUUID") => {
  const field = (await lists()).find((x) => x.type === type)?.listField;
  return field ? (await cs.graphql(`{ ${field}(first: 5000) { ${fields} } }`))?.data?.[field] ?? [] : [];
};
let all = (await cs.schemas()).filter((s) => s.coshareType.startsWith("cg_"));
let byType = new Map(all.filter((s) => s.coshareState === "PUBLISHED").map((s) => [s.coshareType, s]));
const typeOfId = new Map(all.map((s) => [s.coshareUUID, s.coshareType]));
const typesOf = (a) => (a.coshareRefSchemaIds ?? []).map((id) => typeOfId.get(id) ?? id);
const bundleOf = new Map(r.schemas.map((s) => [s.coshareType, s]));
const blocked = [
  ...[...byType.keys()].filter((t) => !bundleOf.has(t)).map((t) => `${t} is gone`),
  ...all.filter((s) => ["DRAFT", "REVIEW"].includes(s.coshareState)).map((s) => `${s.coshareType} has a version in ${s.coshareState}`),
];
const added = r.schemas.filter((s) => !byType.has(s.coshareType));
const versioned = [];
for (const s of r.schemas) {
  const live = byType.get(s.coshareType);
  if (!live) continue;
  const attrs = await cs.attributes(live.coshareUUID);
  const plan = attributePlan(s, attrs, typesOf);
  const groups = groupPlan(s, await cs.groups(live.coshareUUID));
  const differences = [...schemaDifferences(s, attrs, typesOf), ...groups.added.map((n) => `${s.coshareType} group ${n} is new`), ...groups.removed.map((n) => `${s.coshareType} group ${n} is gone`), ...groups.changed.map((c) => `${s.coshareType} group ${c.name}: ${c.what.join(", ")} differ`)];
  if (differences.length) versioned.push({ s, live, plan, differences });
}
step("schemas", { compared: r.schemas.length, new: added.map((s) => s.coshareType), newVersion: versioned.map((v) => `${v.s.coshareType} ${v.live.coshareVersion} +${bumpOf(v.live.coshareVersion, v.s.coshareVersion)}`), blocked });
for (const v of versioned.slice(0, 5)) for (const d of v.differences.slice(0, 8)) console.log(`  ${d}`);
if (blocked.length) {
  console.log("The sync stops: a type is gone or a version is unfinished. Finish or remove it in CoShare, or reload with bin/reset.mjs, then bin/load.mjs.");
  fs.writeFileSync(path.join(out, "sync-log.json"), JSON.stringify(log, null, 2));
  process.exit(1);
}
// Each attribute as a draft or an import takes it: targets that exist now by their current UUID.
const uuidOfType = (t) => byType.get(t)?.coshareUUID ?? bundleOf.get(t)?.coshareUUID;
const forTenant = (a) => withTargets(a, uuidOfType);

// New types: imported and published, as a load does.
if (added.length) {
  const res = await cs.importBundle("schemas", "SCHEMA", added.map((s) => ({ ...s, attributes: s.attributes.map(forTenant), groups: (s.groups ?? []).map((g) => ({ ...g, attributes: g.attributes.map(forTenant) })) })));
  if (!res.dry) {
    for (const it of res.json?.items ?? []) if (it.status !== "SUCCESS") fail(`schema ${added[it.index]?.coshareType}`, it.error ?? JSON.stringify(it));
    for (const s of added) for (const t of ["submit-review", "publish"]) { const y = await cs.transition(s.coshareUUID, t); if (!y.ok) { fail(`${t} ${s.coshareType}`, y.text); break; } }
  }
}

// Changed types: a new version each, then the type's artifacts migrated to it.
const versions = { made: 0, migrated: 0 };
for (const { s, live, plan } of versioned) {
  const ids = (await idsOf(s.coshareType)).map((a) => a.coshareUUID);
  const made = await cs.write("POST", "/schemas/versions", { basedOn: live.coshareUUID, versionBumpType: bumpOf(live.coshareVersion, s.coshareVersion) });
  if (made.dry) continue;
  if (!made.ok) { fail(`new version of ${s.coshareType}`, made.text); continue; }
  const draft = made.json.coshareUUID;
  const k = "?keepVersion=true";
  let ok = true;
  const edit = async (method, url, body, what) => { const e = await cs.call(method, url, body); if (!e.ok) { ok = false; fail(`${s.coshareType} ${made.json.coshareVersion}: ${what}`, e.text); } return e; };
  // The draft's groups first, as the bundle has them; an attribute goes where the bundle puts it.
  const gp = groupPlan(s, await cs.groups(draft));
  const sentGroup = new Map((s.groups ?? []).map((g) => [g.coshareName, g]));
  const groupBody = (g) => ({ coshareName: g.coshareName, coshareDisplayName: g.coshareDisplayName, coshareDescription: g.coshareDescription, coshareOrder: g.coshareOrder });
  for (const n of gp.added) await edit("POST", `/schemas/${draft}/groups${k}`, groupBody(sentGroup.get(n)), `add group ${n}`);
  const draftGroups = new Map((await cs.groups(draft)).map((g) => [g.coshareName, g]));
  for (const c of gp.changed) await edit("PATCH", `/schemas/${draft}/groups/${draftGroups.get(c.name).coshareUUID}${k}`, groupBody(sentGroup.get(c.name)), `change group ${c.name}`);
  // An attribute that changed, its group included, is removed and made again where it belongs:
  // the migration carries no value across, and every page of the type is written again after it.
  const draftAttrs = new Map((await cs.attributes(draft)).map((a) => [a.coshareName, a]));
  const sent = new Map(flatAttributes(s).map((a) => [a.coshareName, a]));
  const body = (n) => { const { group, ...a } = forTenant(sent.get(n)); return a; };
  const where = (a) => (a.group ? `/schemas/${draft}/groups/${a.groupUUID}/attributes/${a.coshareUUID}` : `/schemas/${draft}/attributes/${a.coshareUUID}`);
  for (const n of [...plan.removed, ...plan.changed.map((c) => c.name)]) await edit("DELETE", `${where(draftAttrs.get(n))}${k}`, undefined, `remove ${n}`);
  for (const n of [...plan.added, ...plan.changed.map((c) => c.name)]) {
    const g = sent.get(n).group;
    await edit("POST", g ? `/schemas/${draft}/groups/${draftGroups.get(g).coshareUUID}/attributes${k}` : `/schemas/${draft}/attributes${k}`, body(n), `add ${n}${g ? ` in ${g}` : ""}`);
  }
  for (const n of gp.removed) await edit("DELETE", `/schemas/${draft}/groups/${draftGroups.get(n).coshareUUID}${k}`, undefined, `remove group ${n}`);
  // The description names the unit's version and the commit; a draft takes it with its version kept.
  const d = (await cs.call("GET", `/schemas/${draft}`)).json;
  if (d) { const e = await cs.call("PUT", `/schemas/${draft}?keepVersion=true`, { ...Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("_"))), coshareDescription: s.coshareDescription }); if (!e.ok) fail(`${s.coshareType}: description`, e.text); }
  if (!ok) continue;
  for (const t of ["submit-review", "publish"]) { const y = await cs.transition(draft, t); if (!y.ok) { ok = false; fail(`${t} ${s.coshareType} ${made.json.coshareVersion}`, y.text); break; } }
  if (!ok) continue;
  versions.made++;
  let moved = 0;
  for (const id of ids) {
    const m = await cs.call("POST", `/artifacts/${id}/migrate?toSchemaUUID=${draft}`, {});
    if (m.ok && m.json?.success !== false) moved++; else fail(`migrate ${s.coshareType} ${id}`, m.json?.errorMessage ?? m.text);
  }
  versions.migrated += moved;
}
if (versioned.length || added.length) {
  await cs.write("POST", "/schemas/resolve-references", { schemaUUIDs: (await cs.schemas()).filter((x) => x.coshareType.startsWith("cg_") && x.coshareState === "PUBLISHED").map((x) => x.coshareUUID) });
  all = (await cs.schemas()).filter((s) => s.coshareType.startsWith("cg_"));
  byType = new Map(all.filter((s) => s.coshareState === "PUBLISHED").map((s) => [s.coshareType, s]));
  step("versions", { ...versions, now: versioned.map((v) => `${v.s.coshareType} ${byType.get(v.s.coshareType)?.coshareVersion}`).slice(0, 10) });
  // A type's references to itself stay on its previous version when a new one is published;
  // CoShare's integrity check knows the fix, and only those are applied.
  const stale = ((await cs.call("GET", "/schemas/integrity")).json?.issues ?? []).filter((i) => i.code === "STALE_TARGET_VERSION" && bundleOf.has(i.schemaType) && i.fix?.action === "REPOINT");
  if (stale.length) {
    const fixed = await cs.write("POST", "/schemas/integrity/repair", { dryRun: false, issueIds: stale.map((i) => i.id) });
    const left = (fixed.json?.outcomes ?? []).filter((o) => o.status !== "FIXED");
    for (const o of left) fail(`repoint ${o.issueId}`, o.message);
    step("references to an old version", { repointed: stale.length - left.length, of: stale.length });
  }
}

// The artifacts the tenant holds, with their digests. A type that does not have the digest yet has
// just taken a new version, or is about to in a dry run, and every page of it is written again.
const live = new Map();
for (const type of byType.keys()) {
  // The digest sits in the bookkeeping group, or at the top on a type loaded before groups.
  const grouped = await idsOf(type, "coshareUUID companygraph { companygraph_digest }");
  const flat = grouped.length ? [] : await idsOf(type, "coshareUUID companygraph_digest");
  const held = grouped.length ? grouped : flat.length ? flat : await idsOf(type);
  for (const a of held) live.set(a.coshareUUID, { type, digest: a.companygraph?.companygraph_digest ?? a.companygraph_digest ?? null });
}
const plan = planArtifacts(r.artifacts, live, { rewrite: new Set(versioned.map((v) => v.s.coshareType)) });
step("plan", { added: plan.added.length, changed: plan.changed.length, removed: plan.removed.length, unchanged: plan.unchanged.length, pages: [...plan.added, ...plan.changed].map((a) => addressOf(a)).slice(0, 20) });

// Added pages in one import, a link to a page later in the import waiting for it; then each changed
// page written over its artifact.
const t = { imported: 0, partial: 0, waiting: 0, dropped: 0, written: 0, deleted: 0 };
for (let i = 0; i < plan.added.length; i += 50) {
  const chunk = plan.added.slice(i, i + 50).map((a) => ({ ...a, coshareSchemaUUID: byType.get(a.coshareType)?.coshareUUID ?? a.coshareSchemaUUID }));
  const res = await cs.importBundle("artifacts", "ARTIFACT", chunk);
  if (res.dry) continue;
  for (const it of res.json?.items ?? []) {
    const a = chunk[it.index];
    if (it.status === "SUCCESS") { t.imported++; continue; }
    if (it.status !== "PARTIAL") { fail(`import ${addressOf(a)}`, it.error ?? JSON.stringify(it)); continue; }
    t.imported++; t.partial++;
    for (const f of it.failedReferences ?? []) if (f.waiting) t.waiting++; else { t.dropped++; fail(`link ${addressOf(a)}.${f.attribute} → ${f.refLabel}`, f.reason); }
  }
}
const schemaOfType = new Map(r.schemas.map((s) => [s.coshareType, s]));
for (const a of plan.changed) {
  const refAttrs = flatAttributes(schemaOfType.get(a.coshareType)).filter((x) => x.coshareType === "REFERENCE");
  const res = await writeArtifact(cs, { typeUuid: byType.get(a.coshareType).coshareTypeUUID, artifact: a, refAttrs });
  if (res.ok) t.written++; else fail(`write ${addressOf(a)}`, res.text);
}
for (const a of plan.removed) {
  const res = await cs.write("DELETE", `/schemas/${byType.get(a.coshareType).coshareTypeUUID}/artifacts/${a.coshareUUID}?force=true`);
  if (res.ok) t.deleted++; else fail(`delete ${a.coshareType} ${a.coshareUUID}`, res.text);
}
if (!cs.dry) {
  const waiting = ((await cs.call("GET", "/artifacts/unresolved-references")).json?.unresolvedReferences ?? []).filter((u) => u.refSchemaType?.startsWith("cg_"));
  for (const u of waiting.slice(0, 20)) fail(`link ${u.sourceArtifactId}.${u.attribute} → ${u.refLabel}`, "still waits for its target");
  t.stillWaiting = waiting.length;
}
step("written", t);

log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, cs.dry ? "sync-plan.json" : "sync-log.json"), JSON.stringify(log, null, 2));
console.log(`${log.failures.length} failure(s)`);
process.exitCode = log.failures.length ? 1 : 0;
