#!/usr/bin/env node
// COSHARE_JWT=… node bin/load.mjs <bundles dir> [--only <type,type>] [--dry-run]
//
// Loads what bin/convert.mjs wrote into a CoShare tenant, leaving every type already there as it is:
// 1. schemas, in two passes: those with a reference to several target types go second, once their
//    targets are published, with the targets' CoShare UUIDs already set. CoShare's import resolves
//    only a reference's first target, and editing a draft afterwards would raise its version.
// 2. each schema is submitted for review and published, then its references are resolved.
// 3. artifacts, in chunks of 50, pointed at CoShare's schema UUIDs.
// 4. links: the artifact import drops them, so each artifact is PUT with its references, each link's
//    properties are PATCHed, and every link is read back. A link whose target is not in the tenant
//    yet waits for a later run.
// Writes load-log.json (load-plan.json on a dry run) beside the bundles.
import fs from "node:fs";
import path from "node:path";
import { client } from "../lib/coshare.mjs";

const args = process.argv.slice(2);
const dir = args[0];
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const only = opt("--only")?.split(",").map((t) => `cg_${t.replace(/-/g, "_")}`) ?? null;
if (!dir || dir.startsWith("--")) { console.error("usage: COSHARE_JWT=… node bin/load.mjs <bundles dir> [--only <type,type>] [--dry-run]"); process.exit(2); }
const cs = client({ dry: args.includes("--dry-run") });
const dry = cs.dry;

const log = { startedAt: new Date().toISOString(), dry, only, steps: [], failures: [] };
const step = (name, data) => { log.steps.push({ name, ...data }); console.log(`${name}: ${JSON.stringify(data)}`); };
const fail = (what, detail) => { log.failures.push({ what, detail }); console.log(`  FAIL ${what}: ${String(detail).slice(0, 300)}`); };
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

const schemasIn = read("schemas.bundle.json").items;
const artifactsIn = read("artifacts.bundle.json").items;
const targets = fs.existsSync(path.join(dir, "targets.json")) ? read("targets.json") : [];
const pick = (t) => !only || only.includes(t);
const ours = (list) => list.filter((s) => s.coshareType.startsWith("cg_"));

// 1–2. schemas
const later = new Set(targets.map((f) => f.type));
const have = new Set((await cs.schemas()).map((s) => s.coshareType));
const wanted = schemasIn.filter((s) => pick(s.coshareType));
step("schemas", { selected: wanted.length, alreadyThere: wanted.filter((s) => have.has(s.coshareType)).map((s) => s.coshareType), toImport: wanted.filter((s) => !have.has(s.coshareType)).length, secondPass: wanted.filter((s) => later.has(s.coshareType) && !have.has(s.coshareType)).map((s) => s.coshareType) });

async function importAndPublish(label, items) {
  if (!items.length) return;
  const r = await cs.importBundle("schemas", "SCHEMA", items);
  if (r.dry) return;
  step(`${label} imported`, { http: r.status, succeeded: r.json?.succeeded, failed: r.json?.failed });
  for (const it of r.json?.items ?? []) if (it.status !== "SUCCESS") fail(`schema ${items[it.index]?.coshareType}`, it.error);
  const now = new Map((await cs.schemas()).map((s) => [s.coshareType, s]));
  for (const it of items) {
    const x = now.get(it.coshareType);
    if (!x) { fail(`publish ${it.coshareType}`, "not in CoShare after import"); continue; }
    if (x.coshareVersion !== it.coshareVersion) fail(`version ${it.coshareType}`, `sent ${it.coshareVersion}, CoShare has ${x.coshareVersion}`);
    for (const t of x.coshareState === "PUBLISHED" ? [] : x.coshareState === "REVIEW" ? ["publish"] : ["submit-review", "publish"]) {
      const y = await cs.transition(x.coshareUUID, t);
      if (!y.ok) { fail(`${t} ${it.coshareType}`, y.text); break; }
    }
  }
  const res = await cs.write("POST", "/schemas/resolve-references", { schemaUUIDs: ours(await cs.schemas()).map((s) => s.coshareUUID) });
  if (!res.dry) step(`${label} resolve-references`, res.json ?? { http: res.status });
}

await importAndPublish("pass 1", wanted.filter((s) => !have.has(s.coshareType) && !later.has(s.coshareType)));
let byType = new Map((await cs.schemas()).map((s) => [s.coshareType, s]));
const second = [];
for (const s of wanted.filter((s) => !have.has(s.coshareType) && later.has(s.coshareType))) {
  const item = structuredClone(s);
  for (const f of targets.filter((f) => f.type === s.coshareType)) {
    const ids = f.targets.map((t) => byType.get(t)?.coshareUUID);
    if (ids.some((x) => !x)) { if (!dry) fail(`targets ${f.type}.${f.attribute}`, `not in CoShare: ${f.targets.filter((t) => !byType.get(t)).join(", ")}`); continue; }
    Object.assign(item.attributes.find((x) => x.coshareName === f.attribute), { coshareRefSchemaId: ids[0], coshareRefSchemaIds: ids, coshareItemTypes: f.targets });
  }
  second.push(item);
}
await importAndPublish("pass 2", second);
byType = new Map((await cs.schemas()).map((s) => [s.coshareType, s]));
// Every target of a multi-target reference, read back.
let set = 0;
for (const f of targets.filter((f) => pick(f.type))) {
  const s = byType.get(f.type); if (!s || dry) continue;
  const at = ((await cs.call("GET", `/schemas/${s.coshareUUID}/attributes`)).json?.items ?? []).find((x) => x.coshareName === f.attribute);
  const want = f.targets.map((t) => byType.get(t)?.coshareUUID), got = at?.coshareRefSchemaIds ?? [];
  if (got.length === want.length && want.every((x) => got.includes(x))) set++; else fail(`targets ${f.type}.${f.attribute}`, `read back ${JSON.stringify(got)}`);
}
step("multi-target references", { expected: targets.filter((f) => pick(f.type)).length, set });
const pending = ((await cs.call("GET", "/schemas/pending-references")).json?.data ?? []).filter((p) => p.schemaType.startsWith("cg_"));
step("still pending", { count: pending.length, sample: pending.slice(0, 8).map((p) => `${p.schemaType}.${p.attributeName}→${p.coshareRefSchemaId}`) });

// 3. artifacts
const selected = artifactsIn.filter((a) => pick(a.coshareType));
const exists = async (a) => { const s = byType.get(a.coshareType); return s ? (await cs.call("GET", `/schemas/${s.coshareTypeUUID}/artifacts/${a.coshareUUID}`)).status === 200 : false; };
const present = new Set();
for (const a of selected) if (await exists(a)) present.add(a.coshareUUID);
const toImport = selected.filter((a) => !present.has(a.coshareUUID) && byType.get(a.coshareType)?.coshareState === "PUBLISHED");
step("artifacts", { selected: selected.length, alreadyThere: present.size, toImport: toImport.length, noPublishedSchema: selected.filter((a) => byType.get(a.coshareType)?.coshareState !== "PUBLISHED").length });
const isLink = (v) => v && typeof v === "object" && ("refId" in v || (Array.isArray(v) && v[0]?.refId));
for (let i = 0; i < toImport.length; i += 50) {
  const chunk = toImport.slice(i, i + 50).map((a) => ({ ...a, coshareSchemaUUID: byType.get(a.coshareType).coshareUUID, attributes: Object.fromEntries(Object.entries(a.attributes).filter(([, v]) => !isLink(v))) }));
  const r = await cs.importBundle("artifacts", "ARTIFACT", chunk);
  if (r.dry) continue;
  step(`artifacts ${i + 1}–${i + chunk.length}`, { http: r.status, succeeded: r.json?.succeeded, failed: r.json?.failed });
  for (const it of r.json?.items ?? []) if (it.status !== "SUCCESS") fail(`artifact ${chunk[it.index]?.attributes.address}`, it.error);
}
if (!dry) for (const a of toImport) if (await exists(a)) present.add(a.coshareUUID);
// A link may point at an artifact of a type outside --only that an earlier run loaded.
const known = new Set(present);
for (const a of artifactsIn) if (!pick(a.coshareType) && byType.get(a.coshareType) && (await exists(a))) known.add(a.coshareUUID);
const willExist = (id) => known.has(id) || (dry && artifactsIn.some((x) => x.coshareUUID === id && (pick(x.coshareType) || byType.has(x.coshareType))));

// 4. links
const schemaOfType = new Map(schemasIn.map((s) => [s.coshareType, s]));
let put = 0, linked = 0, waiting = 0, props = 0, missing = 0;
for (const a of selected) {
  if (!present.has(a.coshareUUID) && !dry) continue;
  const s = byType.get(a.coshareType);
  const want = {};
  for (const at of schemaOfType.get(a.coshareType).attributes.filter((x) => x.coshareType === "REFERENCE")) {
    const links = [].concat(a.attributes[at.coshareName] ?? []).filter(Boolean);
    const ready = links.filter((l) => willExist(l.refId));
    waiting += links.length - ready.length;
    if (ready.length) want[at.coshareName] = { at, links: ready };
  }
  if (!Object.keys(want).length) continue;
  const cur = dry ? null : (await cs.call("GET", `/schemas/${s.coshareTypeUUID}/artifacts/${a.coshareUUID}`)).json;
  const body = Object.fromEntries(Object.entries(cur ?? {}).filter(([k]) => !k.startsWith("coshare") && !k.startsWith("_")));
  for (const [n, { at, links }] of Object.entries(want)) body[n] = at.coshareCardinality === "ONE" ? { refId: links[0].refId, refLabel: links[0].refLabel } : links.map((l) => ({ refId: l.refId, refLabel: l.refLabel }));
  const r = await cs.write("PUT", `/schemas/${s?.coshareTypeUUID}/artifacts/${a.coshareUUID}`, body);
  if (!r.ok) { fail(`PUT ${a.attributes.address}`, r.text); continue; }
  put++;
  for (const [n, { links }] of Object.entries(want)) for (const l of links) {
    linked++;
    if (!l.properties) continue;
    const p = await cs.write("PATCH", `/schemas/${s?.coshareTypeUUID}/artifacts/${a.coshareUUID}/references/${n}/${l.refId}`, l.properties);
    if (p.ok) props++; else fail(`PATCH ${a.attributes.address} ${n}→${l.refLabel}`, p.text);
  }
  if (dry) continue;
  const got = (await cs.call("GET", `/schemas/${s.coshareTypeUUID}/artifacts/${a.coshareUUID}/references`)).json?._embedded?.references ?? [];
  for (const [n, { links }] of Object.entries(want)) {
    const ids = new Set((got.find((g) => g.attribute === n)?.references ?? []).map((x) => x.refId));
    for (const l of links) if (!ids.has(l.refId)) { missing++; fail(`readback ${a.attributes.address} ${n}→${l.refLabel}`, "link not there after the PUT"); }
  }
}
step("links", { artifactsPut: put, linksSent: linked, propertiesPatched: props, waitingForTargets: waiting, missingOnReadback: missing });

log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(dir, dry ? "load-plan.json" : "load-log.json"), JSON.stringify(log, null, 2));
console.log(`${log.failures.length} failure(s)`);
process.exitCode = log.failures.length ? 1 : 0;
