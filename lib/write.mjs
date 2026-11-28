// Writing a changed page over the artifact the tenant holds. An OVERWRITE import is refused without
// a word when other artifacts link to the one overwritten (seen 2026-11-28), so a changed page is
// written with a PUT instead. A PUT carries the artifact's whole link set, each link with its
// properties: a link left out is removed, and a reference with no link is sent empty.

/**
 * @param {{ attributes: Record<string, unknown>, references: { attribute: string, refId: string, refLabel: string, properties?: object }[] }} artifact from the bundle
 * @param {{ coshareName: string, coshareCardinality: string }[]} refAttrs the schema's REFERENCE attributes
 */
export function putBody(artifact, refAttrs) {
  const body = Object.fromEntries(Object.entries(artifact.attributes).filter(([, v]) => v !== null && v !== undefined));
  for (const at of refAttrs) {
    const links = artifact.references.filter((l) => l.attribute === at.coshareName).map(({ refId, refLabel, properties }) => ({ refId, refLabel, ...(properties ? { properties } : {}) }));
    if (at.coshareCardinality === "ONE") { if (links.length) body[at.coshareName] = links.at(-1); }
    else body[at.coshareName] = links;
  }
  return body;
}

/** @param {ReturnType<typeof import("./coshare.mjs").client>} cs */
export const writeArtifact = (cs, { typeUuid, artifact, refAttrs }) => cs.write("PUT", `/schemas/${typeUuid}/artifacts/${artifact.coshareUUID}`, putBody(artifact, refAttrs));
