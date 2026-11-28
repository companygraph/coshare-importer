// What a sync has to do, worked out from the bundles and what the tenant holds: pure functions,
// so they can be held to their rules without a tenant.

/**
 * Which artifacts to import, to write again and to delete. A page whose markdown is what the
 * tenant holds has the same values and the same links, since the converter draws both from the
 * page; the commit an artifact was last written at does not count. Every page of a type in
 * `rewrite`, one that has just taken a new schema version, is written again, so the attributes
 * the version added are filled.
 * @param {{ coshareUUID: string, coshareType: string, attributes: Record<string, unknown> }[]} want the bundle's artifacts
 * @param {Map<string, { type: string, markdown: string | null }>} live the tenant's cg_ artifacts by UUID
 * @param {{ rewrite?: Set<string> }} [options]
 */
export function planArtifacts(want, live, { rewrite = new Set() } = {}) {
  const ids = new Set(want.map((a) => a.coshareUUID));
  const same = (a) => !rewrite.has(a.coshareType) && live.get(a.coshareUUID).markdown === a.attributes.markdown;
  return {
    added: want.filter((a) => !live.has(a.coshareUUID)),
    changed: want.filter((a) => live.has(a.coshareUUID) && !same(a)),
    unchanged: want.filter((a) => live.has(a.coshareUUID) && same(a)),
    removed: [...live].filter(([id]) => !ids.has(id)).map(([id, x]) => ({ coshareUUID: id, coshareType: x.type })),
  };
}

const norm = (v) => (v === undefined || v === null || v === "" ? null : typeof v === "string" ? v.toLowerCase() : v);

/**
 * Where a schema in the bundle differs from the one the tenant holds, in what a load depends on:
 * the attributes, their types, cardinality, whether required, classification, allowed values,
 * reference target types, whether a reference takes one link per row, and relationship
 * properties. Descriptions are left out, and so are the UUIDs a reference's targets have now,
 * which change with every new version of a target type.
 * @param {{ coshareType: string, attributes: object[] }} schema from the bundle
 * @param {object[]} liveAttributes the tenant's attributes for that schema
 * @param {(attribute: object) => string[]} typesOf the type names a tenant's reference attribute points at
 * @returns {{ added: string[], removed: string[], changed: { name: string, what: string[] }[] }}
 */
export function attributePlan(schema, liveAttributes, typesOf) {
  const live = new Map(liveAttributes.map((a) => [a.coshareName, a]));
  const names = new Set(schema.attributes.map((a) => a.coshareName));
  const plan = { added: [], removed: [...live.keys()].filter((n) => !names.has(n)), changed: [] };
  for (const a of schema.attributes) {
    const g = live.get(a.coshareName);
    if (!g) { plan.added.push(a.coshareName); continue; }
    const what = [];
    for (const k of ["coshareType", "coshareCardinality", "coshareRequired", "cosharePrivacy", "coshareConfidentiality"]) if (norm(a[k]) !== norm(g[k])) what.push(k);
    const tokens = (x) => JSON.stringify((x.coshareValidators ?? []).filter((v) => v.coshareType === "ALLOWED_VALUES").map((v) => v.value));
    if (tokens(a) !== tokens(g)) what.push("allowed values");
    const props = (x) => JSON.stringify((x.coshareRelationshipProperties ?? []).map((p) => p.coshareName).sort());
    if (props(a) !== props(g)) what.push("relationship properties");
    if (!!a.coshareRefRepeatable !== !!g.coshareRefRepeatable) what.push("repeatable");
    if (a.coshareType === "REFERENCE" && JSON.stringify([...a.coshareRefSchemaTypes].sort()) !== JSON.stringify([...typesOf(g)].sort())) what.push("targets");
    if (what.length) plan.changed.push({ name: a.coshareName, what });
  }
  return plan;
}

/** The same as `attributePlan`, as one sentence per difference; an empty list means none. */
export function schemaDifferences(schema, liveAttributes, typesOf) {
  const p = attributePlan(schema, liveAttributes, typesOf);
  return [
    ...p.added.map((n) => `${schema.coshareType}.${n} is new`),
    ...p.changed.map((c) => `${schema.coshareType}.${c.name}: ${c.what.join(", ")} differ`),
    ...p.removed.map((n) => `${schema.coshareType}.${n} is gone`),
  ];
}

const parts = (v) => v.replace(/^v/, "").split(".").map(Number);

/**
 * The bump that takes a tenant's schema version, `live`, to a new version for a unit at `sent`:
 * the segment the unit moved, or a patch when it did not move, since the importer's mapping
 * changed. CoShare sets a new version by its bump and takes no version number.
 */
export function bumpOf(live, sent) {
  const [a, b] = [parts(live), parts(sent)];
  if (b[0] > a[0]) return "MAJOR";
  if (b[0] === a[0] && b[1] > a[1]) return "MINOR";
  return "PATCH";
}

/** Whether a tenant's version `live` holds a unit at `sent`: the same, or a later patch of it. */
export function versionHolds(live, sent) {
  const [a, b] = [parts(live), parts(sent)];
  return a[0] === b[0] && a[1] === b[1] && a[2] >= b[2];
}

/**
 * A bundle attribute as a draft takes it: a reference's targets as the UUIDs their types have in
 * the tenant now, where the bundle names the vocabulary ids a first load gives them.
 * @param {object} attribute from the bundle
 * @param {(type: string) => string} uuidOfType the current schema UUID of a type
 */
export function withTargets(attribute, uuidOfType) {
  if (attribute.coshareType !== "REFERENCE") return attribute;
  const ids = attribute.coshareRefSchemaTypes.map(uuidOfType);
  return { ...attribute, coshareRefSchemaId: ids[0], coshareRefSchemaIds: ids };
}
