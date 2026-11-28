// What a sync has to do, worked out from the bundles and what the tenant holds: pure functions,
// so they can be held to their rules without a tenant.

/**
 * Which artifacts to import, to write again and to delete. A page whose markdown is what the
 * tenant holds has the same values and the same links, since the converter draws both from the
 * page; the commit an artifact was last written at does not count.
 * @param {{ coshareUUID: string, coshareType: string, attributes: Record<string, unknown> }[]} want the bundle's artifacts
 * @param {Map<string, { type: string, markdown: string | null }>} live the tenant's cg_ artifacts by UUID
 */
export function planArtifacts(want, live) {
  const ids = new Set(want.map((a) => a.coshareUUID));
  return {
    added: want.filter((a) => !live.has(a.coshareUUID)),
    changed: want.filter((a) => live.has(a.coshareUUID) && live.get(a.coshareUUID).markdown !== a.attributes.markdown),
    unchanged: want.filter((a) => live.has(a.coshareUUID) && live.get(a.coshareUUID).markdown === a.attributes.markdown),
    removed: [...live].filter(([id]) => !ids.has(id)).map(([id, x]) => ({ coshareUUID: id, coshareType: x.type })),
  };
}

const norm = (v) => (v === undefined || v === null || v === "" ? null : typeof v === "string" ? v.toLowerCase() : v);

/**
 * Where a schema in the bundle differs from the one the tenant holds, in what a load depends on:
 * the attributes, their types, cardinality, whether required, classification, allowed values,
 * reference targets, whether a reference takes one link per row, and relationship properties. Descriptions are left out. An empty list
 * means the tenant's schema serves the bundle as it is.
 * @param {{ coshareType: string, attributes: object[] }} schema from the bundle
 * @param {object[]} liveAttributes the tenant's attributes for that schema
 * @param {(attribute: object) => string[]} targetsOf the CoShare schema UUIDs a bundle reference should point at
 */
export function schemaDifferences(schema, liveAttributes, targetsOf) {
  const out = [];
  const live = new Map(liveAttributes.map((a) => [a.coshareName, a]));
  for (const a of schema.attributes) {
    const g = live.get(a.coshareName);
    if (!g) { out.push(`${schema.coshareType}.${a.coshareName} is new`); continue; }
    const diff = [];
    for (const k of ["coshareType", "coshareCardinality", "coshareRequired", "cosharePrivacy", "coshareConfidentiality"]) if (norm(a[k]) !== norm(g[k])) diff.push(k);
    const tokens = (x) => JSON.stringify((x.coshareValidators ?? []).filter((v) => v.coshareType === "ALLOWED_VALUES").map((v) => v.value));
    if (tokens(a) !== tokens(g)) diff.push("allowed values");
    const props = (x) => JSON.stringify((x.coshareRelationshipProperties ?? []).map((p) => p.coshareName).sort());
    if (props(a) !== props(g)) diff.push("relationship properties");
    if (!!a.coshareRefRepeatable !== !!g.coshareRefRepeatable) diff.push("repeatable");
    if (a.coshareType === "REFERENCE") {
      const want = [...targetsOf(a)].sort(), got = [...(g.coshareRefSchemaIds ?? [g.coshareRefSchemaId])].filter(Boolean).sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) diff.push("targets");
    }
    if (diff.length) out.push(`${schema.coshareType}.${a.coshareName}: ${diff.join(", ")} differ`);
  }
  const names = new Set(schema.attributes.map((a) => a.coshareName));
  for (const name of live.keys()) if (!names.has(name)) out.push(`${schema.coshareType}.${name} is gone`);
  return out;
}
