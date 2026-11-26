# CompanyGraph in CoShare: findings, 2026-11-26

All of CompanyGraph's mental-model is in CoShare: 54 schemas at core version v0.71.0 and 460 artifacts with 1,955 links, loaded from commit `c439b16` and read back in full with no differences. Getting there took workarounds for seven CoShare behaviors. The two that cost most: the artifact import drops references without a word, and a multi-target reference resolves only its first target at import, with at most 10 targets in all.

We ask CoShare for seven changes, ranked below by what each costs a loader, and list smaller findings after them. CompanyGraph stays the master: what sits in CoShare is a copy at one commit. [`coshare.md`](coshare.md) records each behavior as observed and what the importer does about it.

## How the load works

Four commands in this repository take an instance into CoShare and back out again; each talks to CoShare's REST API, the only way to register a schema.

1. `bin/convert.mjs` reads the instance with `@companygraph/meta-model` 0.99.0, the parser the checks use, and writes bundles in the shape CoShare's own export produces.
2. `bin/reset.mjs` removes every `cg_` artifact and schema, so a load starts from a clean tenant.
3. `bin/load.mjs` imports the schemas in two passes, publishes each and resolves their references; then it imports the artifacts, creates every link and sets every link's properties, reading each link back.
4. `bin/verify.mjs` compares CoShare with the bundles: versions, artifacts, every link with every property and the integrity report. Run against three planted faults, it caught all three.

| CompanyGraph | CoShare |
| --- | --- |
| A type | A schema `cg_<type>`, version of its unit (core or pack), category `companygraph-<unit>` |
| An entity | An artifact with the same UUIDv7 |
| A frontmatter field | An attribute: STRING, DATE, FLOAT or STRING_ARRAY; an enum with `ALLOWED_VALUES` |
| A prose section, list or plain table | A STRING attribute |
| A reference field or table column | A REFERENCE, ONE or many; the row's other cells become edge properties |
| Nesting under an owner | A `nested_in` REFERENCE |
| The page as written | The `markdown` attribute |

Each schema's description names the core version, the meta-model release (v0.99.0) and the commit it was loaded from.

## Requested changes to CoShare

The first two cost the most: together they are why a load needs two passes and about 1,000 calls after the imports.

| # | Request | What we saw | What it costs today |
| --- | --- | --- | --- |
| 1 | Import an artifact's references, with their edge properties, in the artifact bundle | The import answers SUCCESS but creates no link, and lists nothing under unresolved references | One PUT per artifact and one PATCH per link with properties: 458 PUTs and 574 PATCHes for this model |
| 2 | Resolve every target of a multi-target reference at schema import, by type name as the first one is | Only the first target resolves; every other becomes `@pending:unresolved:<value>`, whatever form is sent. Only UUIDs already in the tenant are kept | A two-pass load ordered by what references what. Two multi-target schemas that point at each other could not be loaded at all |
| 3 | Raise the cap of 10 target types per reference, or allow a reference to any type | 12 targets sent, 10 kept, no error | `question.rests_on` reaches 23 types, so it became 23 attributes sharing one relationship type, `RESTS_ON` |
| 4 | Allow more than one link from one attribute to the same target | Links are keyed by artifact, attribute and target: 10 use-case steps by 2 actors came back as 2 links | 31 table rows merged into 17 links; each column's values joined with line breaks, `row` lists the rows |
| 5 | Keep the version set at import when a draft is edited | Editing one attribute of a draft moved v0.71.0 to v0.71.2 | The fill-in step had to go, and the whole model was loaded again |
| 6 | Keep schema UUIDs on import, or report the mapping that was applied | With `PRESERVE_INTERNAL`, schema UUIDs are replaced while the response maps each to itself; artifact UUIDs are kept. `PRESERVE`, listed in the front end, is refused | Every artifact re-pointed at the new schema UUIDs before its import |
| 7 | A long-text type | `TEXT` is offered in the schema editor; the import refuses it: `No enum constant … AttributeType.TEXT` | Prose and whole pages up to 7,084 characters sit in STRING. It works, but the type says nothing about the content |

## Smaller findings

None of these blocked the load; each cost time to find out, or leaves noise a user cannot clear.

| What we saw | What we ask |
| --- | --- |
| `purge` answers a bare `500 PURGE_FAILED` while another schema still references the one being purged | A 409 that names the referencing schemas |
| The integrity check flags `STATUS` as close to `SEATS` and `HOLDS` as close to `UPHOLDS`, with no fix and no way to dismiss | A way to acknowledge a warning, or a heuristic that leaves real words alone |
| `system_cosharePerson` ships with three pending references (`projects`, `skills`, `tasks`), so a fresh tenant's integrity is not intact | Ship the Project, Skill and Task schemas, or drop those attributes |
| GraphQL has no fields for references; links are read only over REST | Reference fields on the generated types, with their edge properties |
| Artifact paths take the schema's type UUID; the schema UUID answers 200 with an empty list | A 404 for an unknown type UUID |
| There is no published API description; we read the endpoints from the foundation front end's code | An OpenAPI description of bundles, transitions and references |
| GraphQL refuses a query that asks `__Type.fields` more than once as "not in good faith" | Name the limit in the error, so tools can split the query |

## What our side does so nothing is lost

Every page can be rebuilt from CoShare alone, because the mapping keeps the original beside each structured value.

- `markdown` holds the whole page as written, so a value the mapping misses survives.
- A table with references keeps its text as `<section>_text`, so a row whose reference failed is still there.
- Every table link carries `row`; with it, a table's links rebuild in their written order, and the links of one row pair up.
- Merged rows keep every cell, one line per row, in the order of `row`.
- `companygraph_id` and `companygraph_commit` name the entity and the commit each artifact came from, whatever UUIDs CoShare assigns.
- Enum fields carry `ALLOWED_VALUES` with the schema's tokens; all 341 enum values in the model pass them.

Three values live only in `markdown`: two profiles' `## Voice` sections and one use case's `primary-actor: Agent` (see the next section).

## Findings in CompanyGraph's own model

The load found no errors in mental-model; it found four places where CompanyGraph's design meets a typed store less easily than it could.

- **Open sections have no typed home.** By the decision "A section is open and a field is closed", a page may carry sections its schema does not declare. Two profiles carry `## Voice`; a typed store can hold such a section only inside the whole page.
- **A reference to any type has no bounded target list.** `ref → by Type` lets `question.rests_on` reach 23 types and `decision.bears_on` 10. A store that types its references needs the list; today the importer reads it off the data, so the schema in CoShare changes when the model does.
- **A `ref?` may name what the model does not hold.** `use-case.primary-actor: Agent` names no seat, which the schema allows. In CoShare it survives only in `markdown`; an Agent seat would make it a link.
- **Five types have schemas and no pages:** achievement-kind, experience, experience-kind, proficiency-level and skill. They load as empty schemas, and `seat.requires` points at skill, which stays empty until someone says what a seat needs.

## Open questions and next steps

- [ ] Decide how a later commit reaches CoShare: a clean reload with `bin/reset.mjs`, or a new schema version per changed type and a migration of its artifacts, which is untested.
- [ ] Send the requested changes to CoShare's maintainers, and agree which of them they take.
- [ ] Confirm the names: types as `cg_<type>`, categories as `companygraph-<unit>`.
- [ ] Load a second instance, to see what generalizes beyond mental-model.
