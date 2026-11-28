# CompanyGraph in CoShare: findings, 2026-11-28

CoShare took all seven changes the [findings report of 2026-11-26](2026-11-26-findings-report.md) asked for, and most of its smaller findings, within two days. The importer has dropped every workaround they made necessary, and mental-model is back in the tenant at commit `07822bf`: 54 schemas at core version v0.71.0, 460 artifacts and 1,986 links, read back with no differences. The 31 table rows that had been merged into 17 links are separate links again, which is why there are 31 more links than on 2026-11-26.

## What changed in the load

The load is now two imports and the publishing between them. The schemas go in one bundle in any order, each under its vocabulary id, and every reference names all its targets by UUID and by type name. The artifacts go in bundles of 50 with their links and the links' properties; a link to an artifact not yet loaded waits for it, and 820 links did so and were made as their targets arrived. The 458 `PUT`s and 574 `PATCH`es after the imports, the second pass over the schemas and the re-pointing of artifacts at reassigned UUIDs are gone. The load took under two minutes.

| # | Request of 2026-11-26 | Seen on 2026-11-28 | In the importer now |
| --- | --- | --- | --- |
| 1 | References in the artifact bundle | `references` beside the attributes, with properties; with `refOriginUUID` a link waits for its target | One import per 50 artifacts, no link step |
| 2 | Every target resolved by type name | All targets resolve once published, the schemas in any order | One pass over the schemas |
| 3 | More than 10 targets | `question.rests_on` holds its 23 | One attribute, not 23 |
| 4 | Several links to one target | `coshareRefRepeatable`, each link with its own `linkId` | One link per table row, merging gone |
| 5 | Keep the version on a draft edit | `?keepVersion=true` | Not needed by a load; a new schema version will edit its draft with it |
| 6 | Keep schema UUIDs | Kept under `PRESERVE_INTERNAL` | A schema's CoShare UUID is its vocabulary id |
| 7 | A long-text type rendered as Markdown | `TEXT`, up to 30,000 characters | Prose, pages and taglines are TEXT |

Of the smaller findings, the API description is published, an unknown type UUID answers 404, and a schema another references now purges, where we had asked for a 409 that names the referencing schemas; the GraphQL findings were not tried again. The similarity warnings on `STATUS` and `HOLDS` stay, which CoShare does not count as urgent, and `system_cosharePerson` still ships with three pending references, which CoShare will fix with an updated schema. Grouped attributes were not tried again, and the importer still groups nothing.

## What we found this time

Four behaviors came to light while the importer was reworked; each is recorded in [`coshare.md`](coshare.md).

| What we saw | What we ask |
| --- | --- |
| An `OVERWRITE` import of an artifact that other artifacts link to answers `SUCCESS` and writes nothing; an artifact nothing links to is overwritten | Overwrite it, or refuse it with a reason |
| A link sent without `refOriginUUID` to an artifact not yet loaded is lost with `waiting: false`, and `POST /artifacts/resolve-references` does not bring it back | Let such a link wait by `refId`, or say in the answer that it is lost for good |
| `GET /schemas` lists purged schemas beside the current schema of the same type | Leave purged schemas out unless asked for |
| A purged schema keeps its UUID, and an import under it is refused as a conflict, so a test tenant cannot take an instance's schemas again after a reset | Free the UUID on purge, or offer a purge that does |

A link's label also keeps the target's old name after the target is renamed, which matters only to a reader who sees the label without following the link.

The last finding matters only to a clean reload. A tenant in use takes a changed schema as a new version of its type, the way CoShare is built for: a draft created from the published version with a patch, minor or major bump, edited with `keepVersion`, published over the previous version, and the artifacts migrated to it. The importer does not do that yet; `bin/sync.mjs` stops on a changed schema.

`bin/sync.mjs` writes a changed page with a `PUT` that carries the page's values and its whole link set with every link's properties, because of the first finding; it was tried by syncing the tenant back to `c439b16` and forward to `07822bf` again, five pages each way, with `bin/verify.mjs` clean after each.

## Open

- [ ] Ask CoShare about the four findings above.
- [ ] Bring a changed schema to a tenant as a new version of its type, with its artifacts migrated, instead of stopping the sync.
- [ ] Decide whether `markdown` stays now that no CoShare limitation requires it.
- [ ] Try grouped attributes again.
- [ ] Load a second instance, to see what generalizes beyond mental-model.
