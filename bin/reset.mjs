#!/usr/bin/env node
// COSHARE_JWT=… node bin/reset.mjs [--dry-run]
//
// Removes everything the importer put into a tenant: every artifact and schema whose type starts
// with cg_. Nothing else is touched. Artifacts and drafts are deleted outright. A published schema
// can only be walked out: deprecate, decommission, archive, purgable and, after CoShare's retention
// period, purge. Purges run in passes until one makes no progress, since a purge refused while the
// retention period runs succeeds on a later pass. A purged schema keeps its UUID in the tenant, so
// the same schemas cannot be loaded into it again.
import { client } from "../lib/coshare.mjs";

const cs = client({ dry: process.argv.includes("--dry-run") });
const ours = async () => (await cs.schemas()).filter((s) => s.coshareType.startsWith("cg_"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Artifacts, listed through each published schema's GraphQL field.
const lists = (await cs.graphql("{ coshareSchemas(first: 500) { items { type listField } } }"))?.data?.coshareSchemas?.items ?? [];
const schemas = await ours();
let deleted = 0, failed = 0;
for (const s of schemas) {
  const field = lists.find((x) => x.type === s.coshareType)?.listField;
  if (!field) continue;
  const ids = ((await cs.graphql(`{ ${field}(first: 5000) { coshareUUID } }`))?.data?.[field] ?? []).map((a) => a.coshareUUID);
  for (const id of ids) {
    const r = await cs.write("DELETE", `/schemas/${s.coshareTypeUUID}/artifacts/${id}?force=true`);
    if (r.ok) deleted++; else { failed++; console.log(`  FAIL delete ${s.coshareType} ${id}: ${r.status} ${r.text.slice(0, 150)}`); }
  }
}
console.log(`artifacts: ${deleted} deleted${cs.dry ? " (dry run)" : ""}, ${failed} failed`);

// Schemas: drafts deleted, the rest walked to purgable.
const walk = { PUBLISHED: ["deprecate", "decommission", "archive", "purgable"], REVIEW: ["reject", "delete-schema"], DEPRECATED: ["decommission", "archive", "purgable"], MIGRATED: ["archive", "purgable"], ARCHIVED: ["purgable"], DRAFT: ["delete-schema"] };
for (const s of schemas) {
  if (s.coshareState === "PURGED") continue;
  const steps = walk[s.coshareState] ?? [];
  console.log(`${s.coshareType} ${s.coshareVersion} ${s.coshareState} → ${steps.join(" → ") || "(no known path)"}`);
  for (const t of steps) {
    const r = await cs.transition(s.coshareUUID, t);
    if (!r.ok) { console.log(`  FAIL ${t}: ${r.status} ${r.text.slice(0, 200)}`); break; }
  }
}
if (cs.dry) process.exit(0);

// Purges, in passes, after the retention period.
let left = (await ours()).filter((s) => s.coshareState === "PURGED");
for (let pass = 1; left.length; pass++) {
  let progress = false;
  for (const s of left) {
    const r = await cs.transition(s.coshareUUID, "purge");
    if (r.ok) { progress = true; console.log(`purged ${s.coshareType} ${s.coshareVersion}`); continue; }
    const until = r.json?.message?.match(/expires at: (.*)$/)?.[1];
    const ms = until ? Date.parse(until) - Date.now() + 3000 : NaN;
    if (ms > 0 && ms < 600000) { console.log(`  retention: waiting ${Math.ceil(ms / 1000)}s`); await wait(ms); progress = true; break; }
    console.log(`  pass ${pass}: ${s.coshareType} ${s.coshareVersion}: ${r.status} ${r.json?.code ?? ""} ${r.json?.message ?? r.text.slice(0, 120)}`);
  }
  left = (await ours()).filter((s) => s.coshareState === "PURGED");
  if (!progress) break;
}
const end = await ours();
console.log(`left in CoShare: ${end.length ? end.map((s) => `${s.coshareType} ${s.coshareVersion} ${s.coshareState}`).join(", ") : "nothing"}`);
process.exitCode = end.length ? 1 : 0;
