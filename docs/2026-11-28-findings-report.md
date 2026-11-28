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
| A schema walked to `purgable` is listed as `PURGED` although it is not purged: it keeps its UUID, and an import under it is refused as a conflict, until a `purge` after the retention period removes it. Our own cleanup took such schemas for purged | List it as `PURGABLE` until it is purged |

A link's label also keeps the target's old name after the target is renamed, which matters only to a reader who sees the label without following the link.

The last finding matters only to a clean reload, and a purge after the retention period takes it away: what we had taken for purged schemas had only been made purgable. A tenant in use takes a changed schema as a new version of its type, the way CoShare is built for, and the importer now does that; the next section says how it went.

`bin/sync.mjs` writes a changed page with a `PUT` that carries the page's values and its whole link set with every link's properties, because of the first finding; it was tried by syncing the tenant back to `c439b16` and forward to `07822bf` again, five pages each way, with `bin/verify.mjs` clean after each.

## A changed schema as a new version

With every CoShare limitation behind `markdown` gone, the whole page no longer needs to sit on each artifact. It gave way to `unmapped`, which holds only what no attribute of the schema holds, the two profiles' `## Voice` sections and one use case's `primary-actor: Agent`, and to `companygraph_digest`, the SHA-256 of the page, by which a sync tells a changed page from one the tenant holds. The page can no longer be rebuilt from CoShare character for character; every value it has is in an attribute, and `bin/verify.mjs` now compares every one of them, 5,938 on mental-model, where it compared the page.

That change to all 54 schemas was the first to reach the tenant as new versions. `bin/sync.mjs` created a draft of each type from its published version with a patch bump, since only the mapping had changed, removed `markdown` and added the two attributes with `keepVersion`, and published it, which deprecated v0.71.0; then it migrated each type's artifacts one by one and wrote every page again. All 54 types are at v0.71.1, with 460 artifacts and 1,986 links read back with no differences, and a second sync finds nothing to do. A draft's version cannot be set, only bumped, so a CoShare version follows the core version by its bump and a change of the importer's mapping alone adds a patch; each schema's description names the core version it was loaded from.

Five more behaviors came to light on the way, the first of them at a cost: archiving the deprecated versions deleted the 460 artifacts that had been migrated from them, and the sync imported them again from the instance.

| What we saw | What we ask |
| --- | --- |
| `decommission` and `archive` of a deprecated version whose artifacts were all migrated to the published version delete those artifacts: they answer 404 and CoShare counts none on either version, and an archived version can only go on to purge | Leave migrated artifacts alone, or refuse to archive a version while its type has artifacts |
| `POST /schemas/{uuid}/retire`, described as archiving a deprecated schema, refuses one: the state machine does not allow DEPRECATED to ARCHIVED | Let `retire` walk the states it needs, or describe what it takes |
| The bulk migration refuses to drop an attribute without a mapping, and does not take one stored with `PUT /schemas/{to}/migration-mappings?fromVersionUUID=` although CoShare's validation of it passes; the migration of one artifact drops it without one | One rule for both, and the bulk migration reading the mapping stored for it |
| An import of a whole schema under the name of a type that exists makes a second type of the same name, beside the first | Refuse it, or make it a version of the type |
| The integrity report checks deprecated and archived versions as well: 14 references from a type to itself stay pinned to the old version, and the typo heuristic fires once per version. After a purge and a new import of the same type name, it names two versions as the working version | Check the published version only, and move a type's references to itself with the rest |

## Grouped attributes

Groups work one level deep. A group keeps its display name, description and order, a grouped value imports, reads back over REST and GraphQL and is written by a `PUT` nested under its group, and a grouped reference links, with its properties and one link per row, through the bundle's `references` and through a nested `PUT`; on 2026-11-26 the import dropped the values, the names and the order, and a nested reference made no link. The importer now groups as the page is: the frontmatter at the top beside the name and tagline, one group per section in the page's order, holding the section's text and the links its table draws, and a last group, `companygraph`, for the id, the address, the digest, what no attribute holds and the commit. All 54 types took it as v0.71.2 through `bin/sync.mjs`, 209 groups in all, and `bin/verify.mjs` reads back every attribute in its group and every value through its group with no differences.

Publishing a version leaves a type's references to itself on the previous version. CoShare's integrity check names each and its fix, and `bin/sync.mjs` now applies those fixes after it publishes: 42 on this change, none left. CoShare's data-quality page shows nothing else of ours; what it lists are `system_cosharePerson`'s three pending references, the typo heuristic, which now counts each of `STATUS` and `HOLDS` on three versions, and leftovers of the throwaway schemas these probes used: three types with two working versions after a purge and an import of the same name, and 32 of the 47 attributes it counted as unclassified. Purging each throwaway schema, which had only been made purgable, removed them, and the page then showed nine warnings and no error: the three pending references, the six typo warnings, and 15 unclassified attributes, all on CoShare's own `system_File` and `system_cosharePerson`.

| What we saw | What we ask |
| --- | --- |
| A group within a group fails the schema import with "the schema was not created", yet a draft is left behind without a state machine, so that no transition removes it; only a `DELETE` of the schema, after its artifacts, does | Import nested groups, or refuse them leaving nothing behind |
| A value sent at the top for a grouped attribute is dropped on import, which answers `SUCCESS`; a `PUT` refuses the same value and says to nest it | Refuse it on import as the `PUT` does |
| A grouped reference named as `group.attribute` in `references` is refused as `RELATIONSHIP_TYPE_REQUIRED`, which does not name the cause | Take the group path, or name the cause |
| `GET /schemas/{uuid}/attributes` lists only the ungrouped attributes | List every attribute, with the group it is in |
| Throwaway schemas made purgable, which the page lists as purged, kept three types with two working versions and 32 unclassified attributes on the data-quality page, with no fix offered there; purging them removed them | Leave schemas made purgable out of the checks, or point to the purge |

## A clean reload

With purging understood, the tenant was emptied and loaded again from mental-model at `07822bf`: `bin/reset.mjs` deleted the 460 artifacts and purged all 162 versions of the 54 types, leaving no `cg_` schema listed, and `bin/load.mjs` imported the 54 schemas under their vocabulary ids at v0.71.0, groups included, and the 460 artifacts, whose 820 links to artifacts not yet loaded waited and were made. Each type now has one version, at the core version it describes. `bin/verify.mjs` reports no differences, a sync finds nothing to do, and CoShare's health counts no error and five warnings: the three pending references of its own `system_cosharePerson` and the typo heuristic on `STATUS` and `HOLDS`, once each.

## Open

- [ ] Ask CoShare about the fourteen findings above.
- [ ] Load a second instance, to see what generalizes beyond mental-model; a tenant holds one instance, since the `cg_` prefix names the meta-model.
