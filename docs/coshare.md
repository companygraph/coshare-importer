# What CoShare does

CoShare publishes no description of its API. What follows was read from the foundation front end's code and confirmed by calls against a tenant on 2026-11-26; each entry says what was observed and what the importer does about it. A change on CoShare's side can make an entry wrong, and `bin/verify.mjs` is how a load finds out.

## Registering and reading

GraphQL cannot register a schema. It is generated from the published schemas, with a list query, a query by UUID and create, update and delete mutations for each, and it exposes an artifact's plain attributes only: a link is read over REST. A query that asks `__Type.fields` more than once is refused as not in good faith. Schemas, artifacts and links are written over REST under `/api/v1`, and a bundle is imported with `POST /api/v1/bundles/{schemas|artifacts}/import/upload`, a multipart upload of the file with `uuidHandling` and `conflictStrategy`.

`uuidHandling` takes `REGENERATE` or `PRESERVE_INTERNAL`; `PRESERVE`, which the front end lists, is refused. Under `PRESERVE_INTERNAL` an artifact keeps its UUID and a schema does not, although the response maps every schema UUID to itself. The importer therefore points each artifact at the schema UUID the tenant reports before it imports the artifact.

An attribute takes STRING, INTEGER, FLOAT, BOOLEAN, DATE, URL, MAIL, UUID, REFERENCE, FILE or an array of one of them, such as STRING_ARRAY. `TEXT` is offered in the schema editor and refused by the import, so prose and whole pages are STRING. A schema keeps the `coshareVersion` it is imported with, but editing a draft raises its patch version.

A schema goes from draft through review to published: `submit-review`, then `publish`. An artifact path takes the schema's type UUID, `/schemas/{typeUuid}/artifacts/{id}`; the schema's own UUID there answers with an empty list and not with a 404.

## Classification and groups

An attribute carries `cosharePrivacy` and `coshareConfidentiality`, each a level from 0 to 3, and the import keeps both as sent; the front end shows them as `P<privacy>/C<confidentiality>` and counts an attribute with neither as level 2. Privacy runs from not personal through indirectly identifying and personal to a special category under GDPR articles 9 and 10, confidentiality from public through internal and confidential to strictly confidential.

A schema can sort its attributes into groups, and a grouped attribute's value then sits inside an object named after its group, in REST and in GraphQL alike. The import keeps the groups and their attributes but drops a group's display name and order, and it drops a grouped value from an artifact without a word: only a `PUT` with the value nested under the group name stores it. A `PUT` of a reference nested under its group answers 200 and creates no link. The importer therefore sorts nothing into groups, and CoShare shows every attribute under Ungrouped Attributes.

## References

A reference to another schema is stored as `@pending:<type>` until that schema is published and `POST /schemas/resolve-references` runs. A reference holds at most 10 target types. The import resolves the first target by its type name; every other entry becomes `@pending:unresolved:…`, whatever form it is sent in, except a schema UUID the tenant already holds. The importer therefore imports a schema whose reference names several types after the schemas it names are published, with their UUIDs written in, and a reference that reaches more than 10 types becomes one attribute per type that shares one relationship type.

The artifact import accepts references written in an artifact, answers success and creates no link, and lists nothing as unresolved. A link is created by a `PUT` of the artifact with `{refId, refLabel}` under the attribute, the way the front end saves one, and its properties are set by a `PATCH` of `/references/{attribute}/{refId}`. The `PUT` carries the artifact's whole link set: a link left out of it is removed, and a link kept keeps its properties, which is how a sync takes away a link a page no longer names. CoShare keeps one link per artifact, attribute and target, so two table rows that name one entity become one link, and the importer keeps both rows on it.

## Removing

An artifact and a draft schema are deleted outright. A published schema is walked out: `deprecate`, `decommission`, `archive`, `purgable` and then `purge`, which CoShare refuses for about a minute after `purgable` and refuses with a bare 500 while another schema still references the one being purged.

## The integrity report

`GET /schemas/integrity` flags references still pending and relationship types it takes for typos, such as `STATUS` beside `SEATS` and `HOLDS` beside `UPHOLDS`; neither kind can be dismissed. CoShare's own `system_cosharePerson` ships with three references pending, so a tenant reports warnings before anything is loaded.
