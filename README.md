# CompanyGraph — CoShare Importer

Loads a CompanyGraph instance into CoShare, a platform where a meta-model is registered as schemas and instances of it as artifacts. Every type the instance's vocabulary declares becomes a CoShare schema at the version of the core or pack it comes from, every page becomes an artifact under its own id, and every reference becomes a link with the rest of its table row on it. CompanyGraph stays the master: what CoShare holds is a copy of the instance at one commit, and each schema and artifact says which.

It reads the instance with the parser `companygraph/meta-model` publishes, at the release `package.json` pins, so a page means in CoShare what it means to the instance's own checks. It holds no rule of its own about what a page may say, and writes nothing back into the instance.

## What it does

`bin/convert.mjs` reads an instance and writes the bundles CoShare's import takes, in the shape CoShare's own export produces: `schemas.bundle.json`, `artifacts.bundle.json` and `report.md`, which counts what was mapped and lists what was not. It reads the instance only and sends nothing. A type becomes the schema `cg_<type>` in the category `companygraph-<unit>`, a frontmatter field an attribute with an enum's tokens as `ALLOWED_VALUES`, a section a TEXT attribute, which CoShare renders as Markdown, and a reference a `REFERENCE` that names every type it can reach. A schema keeps its vocabulary id as its CoShare UUID and an artifact its page's id. The attributes are grouped as the page is: the frontmatter fields sit at the top beside the name and tagline, each section is a group in the page's order holding its text and the links its table draws, and a last group, `companygraph`, holds the bookkeeping. Each table row is a link of its own, with the row's other cells on it and its number as `row`, so a table can be rebuilt from CoShare in the order it was written, and a table that names one entity twice holds two links to it. What no attribute of its schema holds, a section the schema does not declare, a frontmatter field it does not know or a reference that names nothing in the model, goes into `unmapped`, as written, and `report.md` lists each as a loose end. Each artifact also keeps its id in `companygraph_id`, the commit in `companygraph_commit` and the SHA-256 of its page in `companygraph_digest`, by which a sync tells a changed page from one the tenant holds. Every attribute carries CoShare's data classification: privacy from the schemas, personal on a profile and on what a profile owns, indirectly identifying on a reference that can name a profile and not personal elsewhere; confidentiality from `--confidentiality`, one level for the whole instance, since it says where the instance is kept and no schema knows that.

`bin/load.mjs` loads those bundles into a tenant and leaves alone every type already there. It imports the schemas in one pass, publishes each, resolves their references and reads each back, then imports the artifacts with their links; a link to an artifact later in the load waits for it, and the load ends by checking that none still waits. `bin/verify.mjs` reads the tenant and compares it with the bundles: each schema's UUID, state and version, each attribute's classification, every reference's targets, every artifact and its page, and every link with every property and no link more. It also prints CoShare's integrity report. `bin/reset.mjs` removes everything whose type starts with `cg_`, the artifacts first, then the schemas, and touches nothing else.

`bin/sync.mjs` brings a tenant that already holds the instance up to a later commit and writes only what differs: a page the tenant lacks is imported, a page whose text changed is written again with its whole link set, so a link it no longer names goes, and an artifact whose page is gone is deleted. A page the tenant already holds as written is left alone, and so is the commit it was last written at. Before the pages come the schemas: a type the tenant lacks is imported, and a type whose schema changed takes a new version in CoShare, since a published schema cannot change in place. The version takes the bump of the segment the core or pack moved, or a patch where only the importer's mapping changed; its attributes are changed in a draft, it is published over the previous version, and the type's artifacts are migrated to it and written again. A type the instance no longer has stops the sync.

Each step is shaped by what CoShare does, which [`docs/coshare.md`](docs/coshare.md) records with what was observed.

## Running it

Node 22 or later, and a CoShare token in `COSHARE_JWT`. `COSHARE_API` names the tenant's address when it is not `https://api.coshare.ch`.

```sh
npm ci
node bin/convert.mjs ~/git/companygraph/mental-model --confidentiality 0
node bin/load.mjs ~/git/companygraph/mental-model/dist/coshare --dry-run
node bin/load.mjs ~/git/companygraph/mental-model/dist/coshare
node bin/verify.mjs ~/git/companygraph/mental-model/dist/coshare
node bin/sync.mjs ~/git/companygraph/mental-model --confidentiality 0 --dry-run
```

`convert` writes into `dist/coshare/` inside the instance unless `--out` names another folder, `--only` takes a comma-separated list of types for a trial, and `--confidentiality` takes 0 for public, 1 internal, 2 confidential or 3 strictly confidential; without it, CoShare shows confidentiality as not decided. `load` and `reset` take `--dry-run`, which reads the tenant and writes nothing. `--commit` reads the instance at a commit, tag or branch of its repository instead of its working copy, which it does not touch. A later commit reaches a tenant that holds the instance with `sync`, which takes `--commit`, `--confidentiality`, `--out` and `--dry-run` as well; a clean reload, `reset` then `load`, needs a tenant that has not held those schemas before, since CoShare keeps a purged schema's UUID.

## Tests

`npm test` builds a small instance with the parser's own `init` in a temporary folder, adds five pages and holds the conversion to what CoShare needs. Loading and reading back need a tenant and run by hand.

## License

Apache 2.0.
