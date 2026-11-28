#!/usr/bin/env node
// COSHARE_JWT=… node bin/load.mjs <bundles dir> [--only <type,type>] [--dry-run]
//
// Loads what bin/convert.mjs wrote into a CoShare tenant, leaving every type already there as it is:
// 1. the schemas, in one import: each keeps the UUID it is sent with, and a reference names every
//    target by UUID and by type name, so it resolves once its targets are published.
// 2. each schema is submitted for review and published, then the references are resolved, and
//    each schema's UUID, version and reference targets are read back.
// 3. the artifacts, in chunks of 50, each with its links and their properties. A link whose
//    target is not in the tenant yet waits for it, by the target's UUID, and is made when the
//    target arrives, in the same import or a later one.
// 4. what still waits: every link should have found its target once all artifacts are in.
// Writes load-log.json (load-plan.json on a dry run) beside the bundles.
import fs from "node:fs";
import path from "node:path";
import { client } from "../lib/coshare.mjs";
import { flatAttributes } from "../lib/convert.mjs";
import { addressOf } from "../lib/sync.mjs";

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
const pick = (t) => !only || only.includes(t);
const ours = (list) => list.filter((s) => s.coshareType.startsWith("cg_"));

// 1–2. schemas
const have = new Set((await cs.schemas()).map((s) => s.coshareType));
const wanted = schemasIn.filter((s) => pick(s.coshareType));
const toImport = wanted.filter((s) => !have.has(s.coshareType));
step("schemas", { selected: wanted.length, alreadyThere: wanted.filter((s) => have.has(s.coshareType)).map((s) => s.coshareType), toImport: toImport.length });
if (toImport.length) {
  const r = await cs.importBundle("schemas", "SCHEMA", toImport);
  if (!r.dry) {
    step("schemas imported", { http: r.status, succeeded: r.json?.succeeded, failed: r.json?.failed });
    for (const it of r.json?.items ?? []) if (it.status !== "SUCCESS") fail(`schema ${toImport[it.index]?.coshareType}`, it.error ?? JSON.stringify(it));
    const now = new Map((await cs.schemas()).map((s) => [s.coshareType, s]));
    for (const it of toImport) {
      const x = now.get(it.coshareType);
      if (!x) { fail(`publish ${it.coshareType}`, "not in CoShare after import"); continue; }
      for (const t of x.coshareState === "PUBLISHED" ? [] : x.coshareState === "REVIEW" ? ["publish"] : ["submit-review", "publish"]) {
        const y = await cs.transition(x.coshareUUID, t);
        if (!y.ok) { fail(`${t} ${it.coshareType}`, y.text); break; }
      }
    }
    const res = await cs.write("POST", "/schemas/resolve-references", { schemaUUIDs: ours(await cs.schemas()).map((s) => s.coshareUUID) });
    step("resolve-references", res.json ?? { http: res.status });
  }
}
const byType = new Map((await cs.schemas()).map((s) => [s.coshareType, s]));
// Each schema as sent: its UUID, its version, published, and every target of every reference.
let held = 0;
for (const s of wanted) {
  const x = byType.get(s.coshareType);
  if (!x) { if (!dry) fail(`schema ${s.coshareType}`, "not in CoShare"); continue; }
  const problems = [];
  if (x.coshareUUID !== s.coshareUUID) problems.push(`UUID ${x.coshareUUID}, sent ${s.coshareUUID}`);
  if (x.coshareVersion !== s.coshareVersion) problems.push(`version ${x.coshareVersion}, sent ${s.coshareVersion}`);
  if (x.coshareState !== "PUBLISHED") problems.push(x.coshareState);
  const live = new Map((await cs.attributes(x.coshareUUID)).map((a) => [a.coshareName, a]));
  for (const a of flatAttributes(s)) if (!live.has(a.coshareName) || (live.get(a.coshareName).group ?? null) !== a.group) problems.push(`${a.coshareName} ${live.has(a.coshareName) ? `in group ${live.get(a.coshareName).group}, sent ${a.group}` : "missing"}`);
  for (const a of flatAttributes(s).filter((a) => a.coshareType === "REFERENCE")) {
    const got = live.get(a.coshareName)?.coshareRefSchemaIds ?? [];
    if (got.length !== a.coshareRefSchemaIds.length || !a.coshareRefSchemaIds.every((id) => got.includes(id))) problems.push(`${a.coshareName} targets ${JSON.stringify(got)}`);
  }
  if (problems.length) fail(`schema ${s.coshareType}`, problems.join("; ")); else held++;
}
step("schemas read back", { asSent: held, of: wanted.length });

// 3. artifacts
const selected = artifactsIn.filter((a) => pick(a.coshareType));
const exists = async (a) => { const s = byType.get(a.coshareType); return s ? (await cs.call("GET", `/schemas/${s.coshareTypeUUID}/artifacts/${a.coshareUUID}`)).status === 200 : false; };
const present = new Set();
for (const a of selected) if (await exists(a)) present.add(a.coshareUUID);
const artifactsToImport = selected.filter((a) => !present.has(a.coshareUUID) && (dry || byType.get(a.coshareType)?.coshareState === "PUBLISHED"));
step("artifacts", { selected: selected.length, alreadyThere: present.size, toImport: artifactsToImport.length, links: artifactsToImport.reduce((n, a) => n + a.references.length, 0) });
const t = { succeeded: 0, partial: 0, waiting: 0, dropped: 0 };
for (let i = 0; i < artifactsToImport.length; i += 50) {
  const chunk = artifactsToImport.slice(i, i + 50);
  const r = await cs.importBundle("artifacts", "ARTIFACT", chunk);
  if (r.dry) continue;
  for (const it of r.json?.items ?? []) {
    const a = chunk[it.index];
    if (it.status === "SUCCESS") { t.succeeded++; continue; }
    if (it.status !== "PARTIAL") { fail(`artifact ${addressOf(a)}`, it.error ?? JSON.stringify(it)); continue; }
    t.partial++;
    // A link that waits for its target is expected here; one that does not wait is lost.
    for (const f of it.failedReferences ?? []) if (f.waiting) t.waiting++; else { t.dropped++; fail(`link ${addressOf(a)}.${f.attribute} → ${f.refLabel}`, f.reason); }
  }
}
step("artifacts imported", t);

// 4. what still waits once every artifact is in
if (!dry) {
  const waiting = ((await cs.call("GET", "/artifacts/unresolved-references")).json?.unresolvedReferences ?? []).filter((u) => u.refSchemaType?.startsWith("cg_"));
  for (const u of waiting.slice(0, 20)) fail(`link ${u.sourceArtifactId}.${u.attribute} → ${u.refLabel}`, "still waits for its target");
  step("still waiting", { count: waiting.length });
}

log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(dir, dry ? "load-plan.json" : "load-log.json"), JSON.stringify(log, null, 2));
console.log(`${log.failures.length} failure(s)`);
process.exitCode = log.failures.length ? 1 : 0;
