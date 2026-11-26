#!/usr/bin/env node
// COSHARE_JWT=… node bin/verify.mjs <bundles dir>
//
// Reads the tenant back and compares it with the bundles: each schema's state and version, every
// artifact and its page, every link with every property, every target of a multi-target reference, and the
// integrity report. Exits 1 on any difference.
import fs from "node:fs";
import path from "node:path";
import { client } from "../lib/coshare.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: COSHARE_JWT=… node bin/verify.mjs <bundles dir>"); process.exit(2); }
const cs = client();
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const S = read("schemas.bundle.json").items, A = read("artifacts.bundle.json").items, T = read("targets.json");
const problems = [];

const remote = (await cs.schemas()).filter((s) => s.coshareType.startsWith("cg_"));
const byType = new Map(remote.map((s) => [s.coshareType, s]));
for (const s of S) {
  const r = byType.get(s.coshareType);
  if (!r) problems.push(`schema ${s.coshareType} missing`);
  else if (r.coshareVersion !== s.coshareVersion || r.coshareState !== "PUBLISHED") problems.push(`schema ${s.coshareType}: ${r.coshareState} ${r.coshareVersion}, sent ${s.coshareVersion}`);
}
console.log(`schemas: ${remote.length} in CoShare, ${S.length} sent`);

// Each attribute's classification, privacy and confidentiality, as sent.
let classified = 0;
for (const s of S) {
  const r = byType.get(s.coshareType);
  if (!r) continue;
  const got = new Map(((await cs.call("GET", `/schemas/${r.coshareUUID}/attributes`)).json?.items ?? []).map((a) => [a.coshareName, a]));
  for (const a of s.attributes) {
    const g = got.get(a.coshareName);
    if (!g) { problems.push(`attribute ${s.coshareType}.${a.coshareName} missing`); continue; }
    const differ = ["cosharePrivacy", "coshareConfidentiality"].filter((k) => (a[k] ?? null) !== (g[k] ?? null));
    if (differ.length) problems.push(`attribute ${s.coshareType}.${a.coshareName}: ${differ.map((k) => `${k} ${g[k] ?? "unset"}, sent ${a[k] ?? "unset"}`).join("; ")}`); else classified++;
  }
}
console.log(`attributes: ${classified} of ${S.reduce((n, s) => n + s.attributes.length, 0)} classified as sent`);

const lists = (await cs.graphql("{ coshareSchemas(first: 500) { items { type listField } } }")).data.coshareSchemas.items;
let artifacts = 0;
for (const s of S) {
  const field = lists.find((m) => m.type === s.coshareType)?.listField;
  const held = new Map(field ? ((await cs.graphql(`{ ${field}(first: 5000) { coshareUUID markdown } }`)).data?.[field] ?? []).map((a) => [a.coshareUUID, a.markdown]) : []);
  artifacts += held.size;
  for (const a of A.filter((a) => a.coshareType === s.coshareType)) {
    if (!held.has(a.coshareUUID)) problems.push(`artifact ${a.attributes.address} missing`);
    else if (held.get(a.coshareUUID) !== a.attributes.markdown) problems.push(`artifact ${a.attributes.address}: its page differs from the bundle's`);
  }
  for (const id of held.keys()) if (!A.some((a) => a.coshareUUID === id)) problems.push(`artifact ${id} of ${s.coshareType} is not in the bundle`);
}
console.log(`artifacts: ${artifacts} in CoShare, ${A.length} sent`);

let links = 0, exact = 0;
for (const a of A) {
  const want = Object.entries(a.attributes).filter(([, v]) => v && typeof v === "object" && [].concat(v)[0]?.refId);
  const s = byType.get(a.coshareType);
  if (!want.length || !s) continue;
  const got = (await cs.call("GET", `/schemas/${s.coshareTypeUUID}/artifacts/${a.coshareUUID}/references`)).json?._embedded?.references ?? [];
  for (const [attr, v] of want) for (const l of [].concat(v)) {
    links++;
    const g = (got.find((r) => r.attribute === attr)?.references ?? []).find((x) => x.refId === l.refId);
    if (!g) { problems.push(`link ${a.attributes.address}.${attr} → ${l.refLabel} missing`); continue; }
    const diff = Object.entries(l.properties ?? {}).filter(([k, x]) => String(g.properties?.[k] ?? "") !== String(x));
    if (diff.length) problems.push(`link ${a.attributes.address}.${attr} → ${l.refLabel}: ${diff.map(([k]) => k).join(", ")} differ`); else exact++;
  }
}
console.log(`links: ${exact} of ${links} present with every property`);

for (const f of T) {
  const s = byType.get(f.type);
  if (!s) continue;
  const at = ((await cs.call("GET", `/schemas/${s.coshareUUID}/attributes`)).json?.items ?? []).find((x) => x.coshareName === f.attribute);
  const want = f.targets.map((t) => byType.get(t)?.coshareUUID);
  if (!(at?.coshareRefSchemaIds?.length === want.length && want.every((x) => at.coshareRefSchemaIds.includes(x)))) problems.push(`targets ${f.type}.${f.attribute}: ${JSON.stringify(at?.coshareRefSchemaIds)}`);
}
console.log(`multi-target references: ${T.length} checked`);

const ig = (await cs.call("GET", "/schemas/integrity")).json;
console.log(`integrity: ${ig.schemas} schemas, ${ig.errors} errors, ${ig.warnings} warnings`);
for (const i of ig.issues) console.log(`  ${i.severity} ${i.code} ${i.schemaType}.${i.attributeName ?? ""}: ${i.message.slice(0, 140)}`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.slice(0, 30).join("\n  ")}` : "no problems");
process.exitCode = problems.length ? 1 : 0;
