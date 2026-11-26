# CompanyGraph — CoShare Importer

Loads a CompanyGraph instance into CoShare, a platform where a meta-model is registered as schemas and instances of it as artifacts. Every type the instance's vocabulary declares becomes a CoShare schema at the version of the core or pack it comes from, every page becomes an artifact under its own id, and every reference becomes a link with the rest of its table row on it. CompanyGraph stays the master: what CoShare holds is a copy of the instance at one commit, and each schema and artifact says which.

It reads the instance with the parser `companygraph/meta-model` publishes, at the release `package.json` pins, so a page means in CoShare what it means to the instance's own checks. It holds no rule of its own about what a page may say, and writes nothing back into the instance.

## What it does

`bin/convert.mjs` reads an instance and writes the bundles CoShare's import takes, in the shape CoShare's own export produces: `schemas.bundle.json`, `artifacts.bundle.json`, `targets.json` for the references that name several types, and `report.md`, which counts what was mapped and lists what was not. It reads the instance only and sends nothing. A type becomes the schema `cg_<type>` in the category `companygraph-<unit>`, a frontmatter field an attribute with an enum's tokens as `ALLOWED_VALUES`, a section a text attribute and a reference a `REFERENCE`. The row a link came from goes on the link as `row`, beside the row's other cells, so a table can be rebuilt from CoShare in the order it was written. Each artifact also keeps the whole page in `markdown`, its id in `companygraph_id` and the commit in `companygraph_commit`, so nothing the mapping leaves out is lost.

`bin/load.mjs` loads those bundles into a tenant and leaves alone every type already there. It imports the schemas in two passes, publishes each and resolves their references, imports the artifacts, then sets every link and its properties and reads each link back. `bin/verify.mjs` reads the tenant and compares it with the bundles: each schema's state and version, every artifact and every link with every property, and it prints CoShare's integrity report. `bin/reset.mjs` removes everything whose type starts with `cg_`, the artifacts first, then the schemas, and touches nothing else.

Each step is shaped by what CoShare does, which [`docs/coshare.md`](docs/coshare.md) records with what was observed.

## Running it

Node 22 or later, and a CoShare token in `COSHARE_JWT`. `COSHARE_API` names the tenant's address when it is not `https://api.coshare.ch`.

```sh
npm ci
node bin/convert.mjs ~/git/companygraph/mental-model
node bin/load.mjs ~/git/companygraph/mental-model/dist/coshare --dry-run
node bin/load.mjs ~/git/companygraph/mental-model/dist/coshare
node bin/verify.mjs ~/git/companygraph/mental-model/dist/coshare
```

`convert` writes into `dist/coshare/` inside the instance unless `--out` names another folder, and `--only` takes a comma-separated list of types for a trial. `load` and `reset` take `--dry-run`, which reads the tenant and writes nothing. A later commit of the instance reaches CoShare as a clean reload: `reset`, then `load`.

## Tests

`npm test` builds a small instance with the parser's own `init` in a temporary folder, adds five pages and holds the conversion to what CoShare needs. Loading and reading back need a tenant and run by hand.

## License

Apache 2.0.
