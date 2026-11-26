// Writing one artifact's values and links, and reading the links back. CoShare's artifact import
// drops links, and a PUT carries an artifact's whole link set: a link left out is removed, and a
// link kept keeps its properties. Properties are set with a PATCH per link.
import { isLink } from "./sync.mjs";

/**
 * @param {ReturnType<typeof import("./coshare.mjs").client>} cs
 * @param {object} o
 * @param {string} o.typeUuid the schema's type UUID, which artifact paths take
 * @param {{ coshareUUID: string, attributes: Record<string, unknown> }} o.artifact from the bundle
 * @param {object[]} o.refAttrs the schema's REFERENCE attributes, from the bundle
 * @param {(id: string) => boolean} o.exists whether a link's target is in the tenant
 * @param {boolean} [o.clear] send an empty list for a reference with no link, so that links the page
 *   no longer names are removed; for an artifact that already had links
 */
export async function writeArtifact(cs, { typeUuid, artifact, refAttrs, exists, clear = false }) {
  const r = { linked: 0, props: 0, waiting: 0, missing: [], extra: [], failures: [] };
  const url = `/schemas/${typeUuid}/artifacts/${artifact.coshareUUID}`;
  const body = Object.fromEntries(Object.entries(artifact.attributes).filter(([, v]) => v !== null && v !== undefined && !isLink(v)));
  const want = {};
  for (const at of refAttrs) {
    const links = [].concat(artifact.attributes[at.coshareName] ?? []).filter(Boolean);
    const ready = links.filter((l) => exists(l.refId));
    r.waiting += links.length - ready.length;
    want[at.coshareName] = ready;
    if (ready.length) body[at.coshareName] = at.coshareCardinality === "ONE" ? { refId: ready[0].refId, refLabel: ready[0].refLabel } : ready.map((l) => ({ refId: l.refId, refLabel: l.refLabel }));
    else if (clear && at.coshareCardinality !== "ONE") body[at.coshareName] = [];
  }
  const put = await cs.write("PUT", url, body);
  if (!put.ok) { r.failures.push(`PUT ${artifact.attributes.address}: ${put.text}`); return r; }
  for (const [n, links] of Object.entries(want)) for (const l of links) {
    r.linked++;
    if (!l.properties) continue;
    const p = await cs.write("PATCH", `${url}/references/${n}/${l.refId}`, l.properties);
    if (p.ok) r.props++; else r.failures.push(`PATCH ${artifact.attributes.address} ${n}→${l.refLabel}: ${p.text}`);
  }
  if (cs.dry) return r;
  const got = (await cs.call("GET", `${url}/references`)).json?._embedded?.references ?? [];
  for (const [n, links] of Object.entries(want)) {
    const ids = new Set((got.find((g) => g.attribute === n)?.references ?? []).map((x) => x.refId));
    for (const l of links) if (!ids.has(l.refId)) r.missing.push(`${artifact.attributes.address}.${n} → ${l.refLabel}`);
    if (clear) for (const x of got.find((g) => g.attribute === n)?.references ?? []) if (!links.some((l) => l.refId === x.refId)) r.extra.push(`${artifact.attributes.address}.${n} → ${x.refLabel}`);
  }
  return r;
}
