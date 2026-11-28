// The calls the importer makes to CoShare: REST under <base>/api/v1 and GraphQL at <base>/graphql.
// The address comes from COSHARE_API, the token from COSHARE_JWT; both are read when a client is made.

export function client({ base = process.env.COSHARE_API || "https://api.coshare.ch", token = process.env.COSHARE_JWT, dry = false } = {}) {
  if (!token) throw new Error("COSHARE_JWT is not set: a CoShare token is needed to read or write a tenant");
  const api = `${base.replace(/\/$/, "")}/api/v1`;
  const auth = { Authorization: `Bearer ${token}` };

  async function call(method, url, body, { form = false } = {}) {
    const init = { method, headers: { ...auth } };
    if (form) init.body = body;
    else if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    const res = await fetch(url.startsWith("http") ? url : api + url, init);
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, json, text };
  }
  // A dry run reads everything and writes nothing.
  const write = async (...a) => (dry ? { status: 0, ok: true, json: null, dry: true } : call(...a));

  return {
    dry, call, write,
    graphql: async (query) => (await call("POST", `${base.replace(/\/$/, "")}/graphql`, { query })).json,
    /** Every schema in the tenant, any state but purged: CoShare lists a purged schema too, beside a later one of its type. */
    schemas: async () => ((await call("GET", "/schemas")).json?.data ?? []).filter((s) => s.coshareState !== "PURGED"),
    /**
     * A bundle import. PRESERVE_INTERNAL keeps the UUIDs sent, of schemas and artifacts alike. On an
     * item the tenant already holds, FAIL refuses it, and OVERWRITE replaces its values and its
     * whole link set, but answers SUCCESS and writes nothing for an artifact other links point at.
     */
    importBundle: async (kind, bundleType, items, { conflict = "FAIL" } = {}) => {
      const fd = new FormData();
      fd.append("file", new Blob([JSON.stringify({ bundleType, bundleVersion: 1, exportedAt: Date.now(), itemCount: items.length, items })], { type: "application/json" }), `${kind}.json`);
      return write("POST", `/bundles/${kind}/import/upload?uuidHandling=PRESERVE_INTERNAL&conflictStrategy=${conflict}`, fd, { form: true });
    },
    transition: (schemaUuid, name) => write("POST", `/schemas/${schemaUuid}/transition/${name}`, {}),
  };
}
