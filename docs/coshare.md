# What CoShare does

What follows was observed in calls against a tenant, first on 2026-11-26 and again on 2026-11-28, after CoShare had taken the changes our [findings report](2026-11-26-findings-report.md) asked for. Each entry says what was observed and what the importer does about it. A change on CoShare's side can make an entry wrong, and `bin/verify.mjs` is how a load finds out. CoShare publishes an OpenAPI description of its foundation API at `https://api.coshare.ch/swagger/foundation/v3/api-docs`, with a Swagger UI beside it; a flag the importer relies on and that the description leaves out, such as `keepVersion`, is named here.

## Registering and reading

GraphQL cannot register a schema. It is generated from the published schemas, with a list query, a query by UUID and create, update and delete mutations for each, and it exposes an artifact's plain attributes only: a link is read over REST. A query that asks `__Type.fields` more than once is refused as not in good faith. Schemas, artifacts and links are written over REST under `/api/v1`, and a bundle is imported with `POST /api/v1/bundles/{schemas|artifacts}/import/upload`, a multipart upload of the file with `uuidHandling` and `conflictStrategy` in the query.

Under `uuidHandling=PRESERVE_INTERNAL` a schema and an artifact each keep the UUID they are sent with. A schema's type UUID is assigned by CoShare, which keeps the one sent as `coshareOriginTypeUUID`. `conflictStrategy` takes `FAIL`, `SKIP` or `OVERWRITE`. An `OVERWRITE` of an artifact replaces its values and its whole link set and keeps the links other artifacts have to it, but only for an artifact nothing links to: for one that other artifacts link to, it answers `SUCCESS` and writes nothing. `bin/sync.mjs` therefore writes a changed page with a `PUT`.

A purged schema stays in the tenant's list of schemas as `PURGED`, beside any later schema of its type, and the importer leaves it out of every list it reads. It keeps its UUID, and an import under that UUID is refused as a conflict, whatever type name it carries. A tenant that has held an instance's schemas therefore cannot take them again under the same UUIDs after `bin/reset.mjs`. A schema imported under a new UUID with the type name of a purged schema joins the purged schema's type and takes the next patch version, whatever version it is sent with; afterwards CoShare's integrity report can name two versions of that type as its working version.

An attribute takes STRING, TEXT, INTEGER, FLOAT, BOOLEAN, DATE, URL, MAIL, UUID, REFERENCE, FILE or an array of one of them, such as STRING_ARRAY. TEXT holds Markdown, up to 30,000 characters unless a LENGTH rule sets another limit, and the record view renders it; the importer writes prose, whole pages and taglines as TEXT and lists any value over the limit as a loose end. A schema keeps the `coshareVersion` it is imported with. Editing a draft's attribute raises its patch version unless the edit carries `?keepVersion=true`.

A schema goes from draft through review to published: `submit-review`, then `publish`. An artifact path takes the schema's type UUID, `/schemas/{typeUuid}/artifacts/{id}`; a UUID that names no schema answers 404.

## Classification and groups

An attribute carries `cosharePrivacy` and `coshareConfidentiality`, each a level from 0 to 3, and the import keeps both as sent; the front end shows them as `P<privacy>/C<confidentiality>` and counts an attribute with neither as level 2. Privacy runs from not personal through indirectly identifying and personal to a special category under GDPR articles 9 and 10, confidentiality from public through internal and confidential to strictly confidential.

A schema can sort its attributes into groups, and a grouped attribute's value then sits inside an object named after its group, in REST and in GraphQL alike. On 2026-11-26 the import dropped a grouped value and a group's display name and order, and a `PUT` of a reference nested under its group created no link; CoShare reports these fixed, and the importer has not tried them since. It sorts nothing into groups, and CoShare shows every attribute under Ungrouped Attributes.

## References

A reference names its targets twice, as CoShare's export writes them: by schema UUID in `coshareRefSchemaIds` and by type name in `coshareRefSchemaTypes`, the first of each also in `coshareRefSchemaId` and `coshareRefSchemaType`. A target not yet published is held as `@pending:<type>` until `POST /schemas/resolve-references` runs after it is, so a bundle of schemas that reference each other imports in one pass, in any order. A reference took 23 target types on 2026-11-28, which is the most this model needs; where CoShare's limit now lies was not tried.

An artifact's links travel in the artifact bundle, in a `references` list beside its attributes: each names its `attribute`, `relationshipType`, `refId`, `refLabel`, `refSchemaType`, `refOriginUUID` and the link's `properties`. A link whose target the tenant does not hold yet waits for it when it carries `refOriginUUID`, and is made when an artifact with that UUID arrives, in the same import or a later one: the import answers `PARTIAL` with the link under `failedReferences`, `waiting: true`, and `GET /artifacts/unresolved-references` lists it until then. Without `refOriginUUID` such a link is lost, with `waiting: false`, and `POST /artifacts/resolve-references` does not bring it back; the importer sends it on every link.

A reference with `coshareRefRepeatable: true` holds several links to one target, one for each table row that names it, each with its own `linkId` and its own properties; a `PATCH` or `DELETE` of `/references/{attribute}/{refId}` takes `?linkId=` to name one of them. The importer makes every reference drawn from a table repeatable. A `PUT` of an artifact carries its whole link set, with each link's properties inline: a link left out is removed, and a link sent without properties loses them.

A link's `refLabel` is the target's name when the link was made, and stays so when the target is renamed.

## Versions

A published schema does not change; a changed schema is a new version of its type. `POST /schemas/versions` with `basedOn`, the UUID of the published version, and `versionBumpType`, `MAJOR`, `MINOR` or `PATCH`, creates a draft of the same type, with a new UUID and the version bumped; a draft's version cannot be set otherwise, and a `PUT` that sends another is refused as `SCHEMA_VERSION_IMMUTABLE`. Its attributes are added, changed and removed with `?keepVersion=true`, which keeps the version the draft was created with. Publishing it deprecates the previous version, and the references other schemas have to the type move to the new version. An import of the whole schema under the type's name does not make a version: it makes a second type of the same name.

An artifact stays on the version it was written under until it is migrated, and keeps its links when it is. `POST /artifacts/{id}/migrate?toSchemaUUID=` migrates one artifact, dropping the values of attributes the new version does not have. `POST /schemas/{from}/artifacts/migrate?toUUID=` migrates all of a version's artifacts but refuses to drop an attribute's values without a mapping that says so, and did not take the mapping that `PUT /schemas/{to}/migration-mappings?fromVersionUUID=` stored, `{"<attribute>": {"sourceAttribute": "<attribute>", "action": "IGNORE"}}`, although CoShare's own validation of it passed. `bin/sync.mjs` therefore migrates artifact by artifact.

A deprecated version stays as it is. `decommission` and `archive` of one whose artifacts were all migrated delete those artifacts: they answer 404 and CoShare counts none on any version of the type, and an archived version can go on only to purge. `POST /schemas/{uuid}/retire`, described as archiving a deprecated schema with no artifacts, refuses one, since the state machine does not allow DEPRECATED to ARCHIVED.

## Removing

An artifact and a draft schema are deleted outright. A published schema is walked out: `deprecate`, `decommission`, `archive`, `purgable` and then `purge`, which CoShare refuses for about a minute after `purgable`. A schema another still references purges like any other.

## The integrity report

`GET /schemas/integrity` checks every version of a type, deprecated and archived ones too. It flags a reference from a type to itself on an old version as pinned to that version, since such references stay where they were when a new version is published while the others move. It flags references still pending and relationship types it takes for typos, once per version, such as `STATUS` beside `SEATS` and `HOLDS` beside `UPHOLDS`; the typo warnings cannot be dismissed yet. CoShare's own `system_cosharePerson` ships with three references pending, so a tenant reports warnings before anything is loaded; CoShare means to fix that with an updated schema.
