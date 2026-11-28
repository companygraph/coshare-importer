// Writing a changed page over the artifact the tenant holds. An OVERWRITE import is refused without
// a word when other artifacts link to the one overwritten (seen 2026-11-28), so a changed page is
// written with a PUT instead. A PUT carries the artifact's whole link set, each link with its
// properties: a link left out is removed, and a reference with no link is sent empty.

/**
 * @param {{ attributes: Record<string, unknown>, references: { attribute: string, refId: string, refLabel: string, properties?: object }[] }} artifact from the bundle
 * @param {{ coshareName: string, coshareCardinality: string, group?: string | null }[]} refAttrs the schema's REFERENCE attributes, each with its group
 */
export function putBody(artifact, refAttrs) {
  // Values as the bundle holds them, a grouped one under its group's name; an empty value is left out.
  const present = (v) => v !== null && v !== undefined;
  const body = {};
  for (const [k, v] of Object.entries(artifact.attributes)) {
    if (v && typeof v === "object" && !Array.isArray(v)) { const inner = Object.fromEntries(Object.entries(v).filter(([, x]) => present(x))); if (Object.keys(inner).length) body[k] = inner; }
    else if (present(v)) body[k] = v;
  }
  // A reference sits where its attribute does: at the top, or under its group beside the group's values.
  for (const at of refAttrs) {
    const links = artifact.references.filter((l) => l.attribute === at.coshareName).map(({ refId, refLabel, properties }) => ({ refId, refLabel, ...(properties ? { properties } : {}) }));
    const into = at.group ? (body[at.group] ??= {}) : body;
    if (at.coshareCardinality === "ONE") { if (links.length) into[at.coshareName] = links.at(-1); }
    else into[at.coshareName] = links;
  }
  return body;
}

/** @param {ReturnType<typeof import("./coshare.mjs").client>} cs */
export const writeArtifact = (cs, { typeUuid, artifact, refAttrs }) => cs.write("PUT", `/schemas/${typeUuid}/artifacts/${artifact.coshareUUID}`, putBody(artifact, refAttrs));
