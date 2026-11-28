// A CompanyGraph instance as CoShare import bundles: one schema per type, one artifact per page,
// in the shape CoShare's own export produces. Nothing here talks to CoShare.
import crypto from "node:crypto";
import { ownerTypesOf } from "@companygraph/meta-model/instance";
import { load, parserVersion } from "./instance.mjs";

/** The most characters CoShare's TEXT takes without a LENGTH rule. */
export const TEXT_LIMIT = 30000;
/**
 * The type that describes a person. Core's profile says who a person or an agent is; what a type
 * owned by it says, an experience, is that person's history. CoShare's privacy levels: 0 not
 * personal, 1 indirectly identifying, 2 personal, 3 a special category under GDPR art. 9/10.
 */
export const PERSON_TYPE = "profile";

const NS = "6f1c2c7e-3b1e-5d2a-9a57-0c0a1e5c6a11"; // a fixed namespace for the derived type UUIDs
const uuidv5 = (name) => {
  const h = crypto.createHash("sha1").update(Buffer.from(NS.replace(/-/g, ""), "hex")).update(name).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
export const snake = (s) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, "_").toLowerCase();
/** A CoShare type name: no leading underscore, and never the word coshare. */
export const typeName = (type) => `cg_${snake(type)}`;
// Prose and Markdown are TEXT, which CoShare's record view renders as Markdown.
const LONG = "TEXT";
const relType = (attr) => attr.toUpperCase();
const strip = (s) => (s ?? "").replace(/`/g, "").trim();
const isRef = (decl) => /^(array of )?ref\??\s*→/.test(strip(decl));
const mdTable = (t) => [`| ${t.columns.join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const scalarType = (decl) => {
  const t = strip(decl);
  if (t === "date") return "DATE";
  if (t === "number") return "FLOAT";
  if (t === "array") return "STRING_ARRAY";
  return "STRING"; // string, enum, image
};

/**
 * @param {string} root the instance's folder
 * @param {{ only?: string[] | null, confidentiality?: number | null, commit?: string | null }} [options]
 *   only these types, by their CompanyGraph names; confidentiality is the level, 0 to 3, every
 *   attribute takes, since it is a fact
 *   about where the instance is kept and not about any schema, and null leaves it undecided;
 *   commit reads the instance at that commit of its repository instead of its working copy
 */
export function convert(root, { only = null, confidentiality = null, commit: at = null } = {}) {
  if (confidentiality !== null && ![0, 1, 2, 3].includes(confidentiality)) throw new Error(`confidentiality is 0, 1, 2 or 3, not ${confidentiality}`);
  const { vocabulary, constraints, graph, schemas: schemaFiles, files, manifest, unitVersion, commit, name: instance } = load(root, { commit: at });
  const release = manifest.tooling ?? null;

  const schemaOf = new Map(vocabulary.entities.map((s) => [s.address.split("/").pop(), s]));
  // Every type the vocabulary declares, not only those with pages, so every reference has a target.
  const ownerTypes = ownerTypesOf(schemaFiles);
  const types = [...schemaOf.keys()].map((type) => ({ type, owner: ownerTypes.get(type) ?? graph.types.find((t) => t.type === type)?.owner ?? null }));
  const selected = only ? types.filter((t) => only.includes(t.type)) : types;
  const targetsOf = (to) => ({ coshareRefSchemaId: schemaOf.get(to[0]).id, coshareRefSchemaType: typeName(to[0]), coshareRefSchemaIds: to.map((t) => schemaOf.get(t).id), coshareRefSchemaTypes: to.map(typeName) });
  const unitOf = (type) => schemaOf.get(type).address.split("/")[0];
  // A type is personal when it is the person type or is owned, at any depth, by a personal type.
  const ownerOf = new Map(types.map((t) => [t.type, t.owner]));
  const personal = (type, seen = new Set()) => type === PERSON_TYPE || (!!ownerOf.get(type) && !seen.has(type) && personal(ownerOf.get(type), seen.add(type)));
  const table = (s, heading, caption) => s.sections.find((x) => x.heading === heading)?.tables.find((t) => (caption ? strip(t.caption).startsWith(caption) : t.caption === null));
  const rowsOf = (t) => (t ? t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? ""]))) : []);

  const losses = [];
  const plans = new Map();
  // A `ref → by Type` reference lists the types this model reaches through it, most used first.
  const reached = new Map();
  {
    const typeOfId = new Map(graph.entities.map((e) => [e.id, e.type]));
    for (const e of graph.edges) {
      const k = `${typeOfId.get(e.from)}|${e.via}`, t = typeOfId.get(e.to);
      if (!reached.has(k)) reached.set(k, new Map());
      reached.get(k).set(t, (reached.get(k).get(t) ?? 0) + 1);
    }
  }

  for (const { type, owner } of types) {
    const s = schemaOf.get(type);
    const attrs = [];
    const used = new Set();
    const add = (a) => {
      let n = a.coshareName; for (let i = 2; used.has(n); i++) n = `${a.coshareName}_${i}`;
      used.add(n); a.coshareName = n; attrs.push(a); return n;
    };
    const base = (name, ctype, required, description) => ({ coshareName: name, coshareType: ctype, coshareKind: "STRUCTURAL", coshareRequired: required, coshareDescription: description, coshareCardinality: "ONE", coshareReserved: false });

    add(base("name", "STRING", true, "The H1: the entity's canonical name, unique within its type, and within its owner for an owned type."));
    add(base("tagline", LONG, false, "The blockquote under the H1."));
    add(base("companygraph_id", "STRING", true, "The entity's CompanyGraph id, a UUIDv7, which is also its CoShare UUID."));
    add(base("address", "STRING", true, "Where the page sits in the model: <folder>/<slug>."));
    add(base("markdown", LONG, true, "The whole page as written, so nothing the mapping leaves out is lost."));
    add(base("companygraph_commit", "STRING", false, "The commit of the CompanyGraph instance this artifact was loaded from."));

    const refs = new Map(); // via → the attribute's name
    const refDecls = (constraints[type]?.references ?? []).filter((r) => r.form !== "qualifier");
    const refColumnsBySection = new Map();
    for (const r of refDecls) if (r.via.includes(".")) { const [sec] = r.via.split("."); refColumnsBySection.set(sec, (refColumnsBySection.get(sec) ?? 0) + 1); }
    const refName = (r) => {
      if (!r.via.includes(".")) return snake(r.via);
      const [sec, col] = r.via.split(".");
      return refColumnsBySection.get(sec) > 1 ? `${snake(sec)}_${snake(col)}` : snake(sec);
    };

    // Frontmatter: a scalar field becomes an attribute; an enum carries its tokens as ALLOWED_VALUES.
    for (const f of rowsOf(table(s, "Frontmatter"))) {
      const field = strip(f.Field);
      if (!field || field === "id" || isRef(f.Type)) continue;
      const ctype = scalarType(f.Type);
      const note = strip(f.Type) === "image" ? " (the image's path; the image itself is not uploaded)" : "";
      const a = base(snake(field), ctype, /^yes/i.test(strip(f.Required)), strip(f.Description) + note);
      const tokens = (constraints[type]?.enums ?? []).find((x) => x.via === field)?.tokens;
      if (tokens?.length && ctype === "STRING") a.coshareValidators = [{ coshareType: "ALLOWED_VALUES", value: tokens }];
      add(a);
    }

    // Sections: each becomes a STRING attribute; a section whose table draws references keeps its
    // text as <section>_text, so a row whose reference did not resolve is still there.
    for (const r of refDecls) used.add(refName(r));
    if (owner) used.add("nested_in");
    for (const sec of rowsOf(table(s, "Sections"))) {
      const m = strip(sec.Section).match(/^##\s+(.+)$/);
      if (!m) continue; // the H1 and the statement are name and tagline
      const heading = m[1].replace(/^\[|\]$/g, "");
      const hasRefs = refColumnsBySection.has(heading);
      const n = snake(heading);
      add({ ...base(hasRefs || used.has(n) ? `${n}_text` : n, LONG, /^yes/i.test(strip(sec.Required)) && !hasRefs, strip(sec.Description)), section: true });
    }
    for (const r of refDecls) used.delete(refName(r));
    used.delete("nested_in");

    // References: a table's other cells, and the row's number, become the link's properties.
    for (const r of refDecls) {
      const name = refName(r);
      let props = [];
      if (r.via.includes(".")) {
        const [sec, col] = r.via.split(".");
        props = [
          { coshareName: "row", coshareType: "STRING", coshareRequired: false, coshareDescription: `The row in the page's "## ${sec}" table, from 1` },
          ...rowsOf(table(s, "Sections", `## ${sec}`)).filter((c) => strip(c.Column) !== col && !isRef(c.Type)).map((c) => ({ coshareName: snake(strip(c.Column)), coshareType: "STRING", coshareRequired: false, coshareDescription: strip(c.Description) })),
        ];
      }
      const targetTypes = r.target ? [r.target] : [...(reached.get(`${type}|${r.via}`) ?? new Map())].sort((x, y) => y[1] - x[1]).map(([t]) => t).filter((t) => schemaOf.has(t));
      if (!targetTypes.length) { losses.push(`${type}: \`${r.via}\` may name any type and names none in this model; no attribute made`); continue; }
      // Every target by its schema UUID, which the import keeps, and by its type name, as CoShare's
      // export writes them; a table may name one entity in several rows, one link each.
      const inTable = r.via.includes(".");
      refs.set(r.via, add({
        coshareName: name, coshareType: "REFERENCE", coshareKind: "REFERENCE",
        coshareRequired: r.required && r.form !== "ref?" && !inTable,
        coshareCardinality: r.array || inTable ? "many" : "ONE",
        ...(inTable ? { coshareRefRepeatable: true } : {}),
        coshareDescription: `${r.target ? "" : `Any of: ${targetTypes.join(", ")}, the types this model reaches. `}CompanyGraph: ${r.via}${r.form === "ref?" ? " (may name an entity outside the model)" : ""}`,
        coshareReserved: false,
        ...targetsOf(targetTypes),
        coshareRelationshipType: relType(name),
        coshareRelationshipProperties: props.map((x) => ({ ...x })),
        targetTypes,
      }));
    }
    if (owner) {
      refs.set("nested-in", add({ coshareName: "nested_in", coshareType: "REFERENCE", coshareKind: "REFERENCE", coshareRequired: true, coshareCardinality: "ONE", coshareDescription: `The ${owner} this ${type} is nested under.`, coshareReserved: false, ...targetsOf([owner]), coshareRelationshipType: "NESTED_IN", coshareRelationshipProperties: [], targetTypes: [owner] }));
    }

    // Classification: every attribute of a personal type is personal; elsewhere a reference that
    // can name a personal entity identifies a person indirectly, and the rest is not personal.
    for (const a of attrs) {
      a.cosharePrivacy = personal(type) ? 2 : (a.targetTypes ?? []).some((t) => personal(t)) ? 1 : 0;
      if (confidentiality !== null) a.coshareConfidentiality = confidentiality;
    }

    const purpose = s.sections.find((x) => x.heading === "Purpose")?.text?.trim();
    const version = unitVersion(unitOf(type));
    plans.set(type, {
      refs,
      attrs,
      item: {
        entityType: "SCHEMA",
        coshareUUID: s.id,
        coshareTypeUUID: uuidv5(`companygraph:type:${type}`),
        coshareType: typeName(type),
        coshareVersion: `v${version ?? "0.0.0"}`,
        coshareState: "DRAFT",
        coshareCategory: `companygraph-${unitOf(type)}`,
        coshareIcon: null,
        coshareDescription: [s.tagline, purpose, `CompanyGraph ${unitOf(type)} ${version ?? "?"}, meta-model release v${release ?? "?"}, loaded from ${instance} ${commit ?? "?"}.`].filter(Boolean).join("\n\n"),
        coshareLabelAttribute: "name",
        attributes: attrs,
        groups: [],
      },
    });
  }

  // The entities.
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const edgesFrom = new Map();
  for (const e of graph.edges) { if (!edgesFrom.has(e.from)) edgesFrom.set(e.from, []); edgesFrom.get(e.from).push(e); }
  const artifacts = [];
  for (const e of graph.entities) {
    if (only && !only.includes(e.type)) continue;
    const plan = plans.get(e.type);
    if (!plan) { losses.push(`entity ${e.address}: type \`${e.type}\` has no schema in the vocabulary; skipped`); continue; }
    const names = new Set(plan.attrs.map((a) => a.coshareName));
    const v = { name: e.name, tagline: e.tagline || null, companygraph_id: e.id, address: e.address, companygraph_commit: commit, markdown: files.get(e.path) };
    for (const [k, val] of Object.entries(e.fields)) {
      const n = snake(k);
      if (k === "id" || !names.has(n)) continue;
      const a = plan.attrs.find((x) => x.coshareName === n);
      if (a.coshareType === "REFERENCE") continue;
      v[n] = a.coshareType === "STRING_ARRAY" ? [].concat(val) : a.coshareType === "FLOAT" ? Number(val) : Array.isArray(val) ? val.join(", ") : val;
    }
    for (const sec of e.sections) {
      const n = [`${snake(sec.heading)}_text`, snake(sec.heading)].find((x) => plan.attrs.some((a) => a.coshareName === x && a.section));
      if (!n) { losses.push(`${e.address}: section "## ${sec.heading}" is not in the ${e.type} schema; kept only in \`markdown\``); continue; }
      v[n] = [sec.text.trim(), ...sec.tables.map((t) => (t.caption ? `${t.caption}\n\n` : "") + mdTable(t))].filter(Boolean).join("\n\n");
    }
    const references = [];
    const edges = [...(edgesFrom.get(e.id) ?? []), ...(e.owner ? [{ from: e.id, to: e.owner, via: "nested-in", attrs: {} }] : [])];
    const usedRows = new Map(); // via → the row indexes already matched
    for (const edge of edges) {
      const n = plan.refs.get(edge.via);
      const target = byId.get(edge.to);
      if (!n) { losses.push(`${e.address}: an edge via \`${edge.via}\` has no attribute in the ${e.type} schema`); continue; }
      // refOriginUUID lets a link wait for a target the tenant does not hold yet.
      const link = { attribute: n, relationshipType: relType(n), refId: edge.to, refLabel: target?.name ?? edge.to, refSchemaType: target ? typeName(target.type) : undefined, refOriginUUID: edge.to };
      if (edge.via.includes(".")) {
        // The row this edge came from: the first not yet matched whose other cells are this edge's
        // attrs, where a cell naming an entity matches that entity's id.
        const [sec, col] = edge.via.split(".");
        const t = e.sections.find((x) => x.heading === sec)?.tables.find((x) => x.columns.includes(col));
        let row = null, cells = null;
        if (t) {
          const taken = usedRows.get(edge.via) ?? new Set(); usedRows.set(edge.via, taken);
          const i = t.rows.findIndex((r, i) => !taken.has(i) && Object.entries(edge.attrs).every(([k, x]) => [x, byId.get(x)?.name].includes(r[t.columns.indexOf(k)])) && (r[t.columns.indexOf(col)] ?? "").includes(target?.name ?? "\u0000"));
          if (i >= 0) { taken.add(i); row = String(i + 1); cells = t.rows[i]; }
        }
        // A cell that names another entity is kept as written; that entity is its own link, on the same row.
        const text = (k, x) => (cells ? cells[t.columns.indexOf(k)] : byId.get(x)?.name ?? x);
        link.properties = { ...(row ? { row } : {}), ...Object.fromEntries(Object.entries(edge.attrs).map(([k, x]) => [snake(k), text(k, x)])) };
        if (!row && t) losses.push(`${e.address}: a ${edge.via} edge to "${target?.name}" matched no table row; sent without \`row\``);
      } else if (Object.keys(edge.attrs).length) link.properties = Object.fromEntries(Object.entries(edge.attrs).map(([k, x]) => [snake(k), x]));
      const a = plan.attrs.find((x) => x.coshareName === n);
      if (a.coshareCardinality === "ONE") { const i = references.findIndex((l) => l.attribute === n); if (i >= 0) references.splice(i, 1); }
      references.push(link);
    }
    // A frontmatter reference whose value drew no edge: a `ref?` naming something outside the model.
    for (const [k, val] of Object.entries(e.fields)) {
      const n = plan.refs.get(k);
      if (!n) continue;
      const drawn = new Set(references.filter((l) => l.attribute === n).map((l) => l.refLabel));
      for (const x of [].concat(val)) if (!drawn.has(x)) losses.push(`${e.address}: \`${k}: ${x}\` names no entity in the model; kept only in \`markdown\``);
    }
    for (const a of plan.attrs) if (a.coshareType === "TEXT" && (v[a.coshareName]?.length ?? 0) > TEXT_LIMIT) losses.push(`${e.address}: \`${a.coshareName}\` is ${v[a.coshareName].length} characters, over CoShare's TEXT limit of ${TEXT_LIMIT}`);
    artifacts.push({ entityType: "ARTIFACT", coshareUUID: e.id, coshareType: typeName(e.type), coshareSchemaUUID: schemaOf.get(e.type).id, coshareSchemaType: typeName(e.type), coshareState: "DRAFT", coshareName: e.name, coshareDescription: e.tagline || null, attributes: v, references });
  }

  const schemas = selected.map((t) => { const it = plans.get(t.type).item; return { ...it, attributes: it.attributes.map(({ section, targetTypes, ...a }) => a) }; });
  const multi = schemas.reduce((n, s) => n + s.attributes.filter((a) => (a.coshareRefSchemaTypes?.length ?? 0) > 1).length, 0);
  return {
    instance, commit, parser: parserVersion(), only,
    schemas, artifacts,
    losses, counts: { schemas: schemas.length, attributes: schemas.reduce((n, s) => n + s.attributes.length, 0), artifacts: artifacts.length, links: artifacts.reduce((n, a) => n + a.references.length, 0), multi },
  };
}

/** What a conversion mapped, and what it could not, for a person to read. */
export function report(r) {
  return `# ${r.instance} for CoShare

Read at \`${r.commit ?? "unknown"}\` with @companygraph/meta-model ${r.parser ?? "?"}.${r.only ? ` Only: ${r.only.join(", ")}.` : ""}

| What | Count |
| --- | --- |
| Schemas, one per type | ${r.counts.schemas} |
| Attributes | ${r.counts.attributes} |
| Artifacts, one per page | ${r.counts.artifacts} |
| Links | ${r.counts.links} |
| References with several target types | ${r.counts.multi} |

## Loose ends

${r.losses.length ? r.losses.map((l) => `- ${l}`).join("\n") : "None."}
`;
}
