#!/usr/bin/env node
// COSHARE_JWT=… node bin/verify.mjs <bundles dir>
//
// Reads the tenant back and compares it with the bundles: each type's published schema and its
// version, which is the unit's or, after a change of the importer's mapping, a later patch of it;
// every attribute and its classification; every reference's target types, each at its current
// version; every artifact and its page; every link with every property and no link more; and the
// integrity report. Exits 1 on any difference.
import fs from "node:fs";
import path from "node:path";
import { client } from "../lib/coshare.mjs";
import { versionHolds } from "../lib/sync.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: COSHARE_JWT=… node bin/verify.mjs <bundles dir>"); process.exit(2); }
const cs = client();
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const S = read("schemas.bundle.json").items, A = read("artifacts.bundle.json").items;
const problems = [];

const remote = (await cs.schemas()).filter((s) => s.coshareType.startsWith("cg_"));
const byType = new Map(remote.filter((s) => s.coshareState === "PUBLISHED").map((s) => [s.coshareType, s]));
const byId = new Map(remote.map((s) => [s.coshareUUID, s]));
for (const s of S) {
  const r = byType.get(s.coshareType);
  if (!r) problems.push(`schema ${s.coshareType}: no published version`);
  else if (!versionHolds(r.coshareVersion, s.coshareVersion)) problems.push(`schema ${s.coshareType}: ${r.coshareVersion}, sent ${s.coshareVersion}`);
}
for (const s of remote) if (["DRAFT", "REVIEW"].includes(s.coshareState)) problems.push(`schema ${s.coshareType}: a version in ${s.coshareState}`);
for (const t of byType.keys()) if (!S.some((s) => s.coshareType === t)) problems.push(`schema ${t} is not in the bundle`);
console.log(`schemas: ${byType.size} types published in CoShare (${remote.length} versions), ${S.length} sent`);

// Each attribute's classification, privacy and confidentiality, as sent, and each reference's targets.
let classified = 0, targeted = 0, references = 0;
for (const s of S) {
  const r = byType.get(s.coshareType);
  if (!r) continue;
  const got = new Map(((await cs.call("GET", `/schemas/${r.coshareUUID}/attributes`)).json?.items ?? []).map((a) => [a.coshareName, a]));
  for (const n of got.keys()) if (!s.attributes.some((a) => a.coshareName === n)) problems.push(`attribute ${s.coshareType}.${n} is not in the bundle`);
  for (const a of s.attributes) {
    const g = got.get(a.coshareName);
    if (!g) { problems.push(`attribute ${s.coshareType}.${a.coshareName} missing`); continue; }
    const differ = ["cosharePrivacy", "coshareConfidentiality"].filter((k) => (a[k] ?? null) !== (g[k] ?? null));
    if (differ.length) problems.push(`attribute ${s.coshareType}.${a.coshareName}: ${differ.map((k) => `${k} ${g[k] ?? "unset"}, sent ${a[k] ?? "unset"}`).join("; ")}`); else classified++;
    if (a.coshareType !== "REFERENCE") continue;
    references++;
    // Each target by its type, at the version of it that is published now.
    const ids = g.coshareRefSchemaIds ?? [];
    const types = ids.map((x) => byId.get(x)?.coshareType ?? x);
    const stale = ids.filter((x) => byId.get(x)?.coshareState !== "PUBLISHED");
    if (JSON.stringify([...types].sort()) === JSON.stringify([...a.coshareRefSchemaTypes].sort()) && !stale.length && !!g.coshareRefRepeatable === !!a.coshareRefRepeatable) targeted++;
    else problems.push(`reference ${s.coshareType}.${a.coshareName}: targets ${JSON.stringify(types)}${stale.length ? `, ${stale.length} not at the published version` : ""}, repeatable ${!!g.coshareRefRepeatable}`);
  }
}
console.log(`attributes: ${classified} of ${S.reduce((n, s) => n + s.attributes.length, 0)} classified as sent`);
console.log(`references: ${targeted} of ${references} with every target as sent`);

const lists = (await cs.graphql("{ coshareSchemas(first: 500) { items { type listField } } }")).data.coshareSchemas.items;
// Every value of every artifact as sent, read over GraphQL, which holds the plain attributes.
const sameValue = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null) || (typeof y === "string" && typeof x === "string" && x.slice(0, 10) === y && /^\d{4}-\d\d-\d\d$/.test(y));
let artifacts = 0, values = 0, exactValues = 0;
for (const s of S) {
  const field = lists.find((m) => m.type === s.coshareType)?.listField;
  const names = s.attributes.filter((a) => a.coshareType !== "REFERENCE").map((a) => a.coshareName);
  const held = new Map(field ? ((await cs.graphql(`{ ${field}(first: 5000) { coshareUUID ${names.join(" ")} } }`)).data?.[field] ?? []).map((a) => [a.coshareUUID, a]) : []);
  artifacts += held.size;
  for (const a of A.filter((a) => a.coshareType === s.coshareType)) {
    const h = held.get(a.coshareUUID);
    if (!h) { problems.push(`artifact ${a.attributes.address} missing`); continue; }
    for (const n of names) { values++; if (sameValue(h[n], a.attributes[n])) exactValues++; else problems.push(`artifact ${a.attributes.address}: ${n} differs from the bundle's`); }
  }
  for (const id of held.keys()) if (!A.some((a) => a.coshareUUID === id)) problems.push(`artifact ${id} of ${s.coshareType} is not in the bundle`);
}
console.log(`artifacts: ${artifacts} in CoShare, ${A.length} sent; values: ${exactValues} of ${values} as sent`);

// Links: each sent link matched to one the tenant holds with the same target and every property
// equal, so two rows naming one entity need two links; a link left over is one too many.
const same = (l, g) => g.refId === l.refId && Object.entries(l.properties ?? {}).every(([k, x]) => String(g.properties?.[k] ?? "") === String(x));
let links = 0, exact = 0;
for (const a of A) {
  const s = byType.get(a.coshareType);
  if (!s) continue;
  const got = ((await cs.call("GET", `/schemas/${s.coshareTypeUUID}/artifacts/${a.coshareUUID}/references`)).json?._embedded?.references ?? []).flatMap((g) => g.references.map((r) => ({ ...r, attribute: g.attribute })));
  for (const l of a.references) {
    links++;
    const i = got.findIndex((g) => g.attribute === l.attribute && same(l, g));
    if (i >= 0) { got.splice(i, 1); exact++; continue; }
    problems.push(got.some((g) => g.attribute === l.attribute && g.refId === l.refId) ? `link ${a.attributes.address}.${l.attribute} → ${l.refLabel}: properties differ` : `link ${a.attributes.address}.${l.attribute} → ${l.refLabel} missing`);
  }
  for (const g of got) problems.push(`link ${a.attributes.address}.${g.attribute} → ${g.refLabel} is not in the bundle`);
}
console.log(`links: ${exact} of ${links} present with every property`);

const ig = (await cs.call("GET", "/schemas/integrity")).json;
console.log(`integrity: ${ig.schemas} schemas, ${ig.errors} errors, ${ig.warnings} warnings`);
for (const i of ig.issues) console.log(`  ${i.severity} ${i.code} ${i.schemaType}.${i.attributeName ?? ""}: ${i.message.slice(0, 140)}`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.slice(0, 30).join("\n  ")}` : "no problems");
process.exitCode = problems.length ? 1 : 0;
