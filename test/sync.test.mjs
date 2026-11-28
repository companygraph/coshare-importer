// The sync's plan and its schema comparison, without a tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planArtifacts, schemaDifferences, attributePlan, bumpOf, versionHolds, withTargets } from "../lib/sync.mjs";

const art = (id, digest) => ({ coshareUUID: id, coshareType: "cg_seat", attributes: { address: `seats/${id}`, companygraph_digest: digest } });

test("a sync imports what is new, writes what changed, deletes what is gone and leaves the rest", () => {
  const live = new Map([["a", { type: "cg_seat", digest: "same" }], ["b", { type: "cg_seat", digest: "old" }], ["c", { type: "cg_seat", digest: "gone" }]]);
  const p = planArtifacts([art("a", "same"), art("b", "new"), art("d", "added")], live);
  assert.deepEqual(p.added.map((a) => a.coshareUUID), ["d"]);
  assert.deepEqual(p.changed.map((a) => a.coshareUUID), ["b"]);
  assert.deepEqual(p.unchanged.map((a) => a.coshareUUID), ["a"]);
  assert.deepEqual(p.removed, [{ coshareUUID: "c", coshareType: "cg_seat" }]);
});

const ref = { coshareName: "by", coshareType: "REFERENCE", coshareCardinality: "ONE", coshareRequired: true, cosharePrivacy: 0, coshareRefSchemaType: "cg_seat", coshareRelationshipProperties: [{ coshareName: "row" }] };
const text = { coshareName: "kind", coshareType: "STRING", coshareCardinality: "ONE", coshareRequired: false, cosharePrivacy: 0, coshareValidators: [{ coshareType: "ALLOWED_VALUES", value: ["a", "b"] }] };
const schema = { coshareType: "cg_decision", attributes: [ref, text] };
const liveOf = (over = {}) => [{ ...ref, coshareCardinality: "one", coshareRefSchemaIds: ["seat-uuid"], ...over.ref }, { ...text, ...over.text }];
const typeOfId = new Map([["seat-uuid", "cg_seat"], ["seat-uuid-2", "cg_seat"], ["other-uuid", "cg_other"]]);
const typesOf = (a) => (a.coshareRefSchemaIds ?? []).map((x) => typeOfId.get(x));
ref.coshareRefSchemaTypes = ["cg_seat"];

test("a schema the tenant holds as it is shows no difference, case of cardinality aside", () => {
  assert.deepEqual(schemaDifferences(schema, liveOf(), typesOf), []);
});

test("a schema that changed names each attribute and what changed in it", () => {
  assert.deepEqual(schemaDifferences(schema, liveOf({ ref: { coshareRefSchemaIds: ["other-uuid"] } }), typesOf), ["cg_decision.by: targets differ"]);
  assert.deepEqual(schemaDifferences(schema, liveOf({ text: { cosharePrivacy: 2, coshareValidators: [] } }), typesOf), ["cg_decision.kind: cosharePrivacy, allowed values differ"]);
  assert.deepEqual(schemaDifferences(schema, [liveOf()[0]], typesOf), ["cg_decision.kind is new"]);
  assert.deepEqual(schemaDifferences({ ...schema, attributes: [ref] }, liveOf(), typesOf), ["cg_decision.kind is gone"]);
});

test("a table reference that stops or starts taking one link per row is a difference", () => {
  const repeatable = { ...schema, attributes: [{ ...ref, coshareRefRepeatable: true }, text] };
  assert.deepEqual(schemaDifferences(repeatable, liveOf(), typesOf), ["cg_decision.by: repeatable differ"]);
  assert.deepEqual(schemaDifferences(repeatable, liveOf({ ref: { coshareRefRepeatable: true } }), typesOf), []);
  assert.deepEqual(schemaDifferences(schema, liveOf({ ref: { coshareRefRepeatable: false } }), typesOf), []);
});

test("a page of a type that took a new version is written again, whatever its digest", () => {
  const live = new Map([["a", { type: "cg_seat", digest: "same" }], ["b", { type: "cg_role", digest: "same" }]]);
  const p = planArtifacts([art("a", "same"), { ...art("b", "same"), coshareType: "cg_role" }], live, { rewrite: new Set(["cg_seat"]) });
  assert.deepEqual(p.changed.map((a) => a.coshareUUID), ["a"]);
  assert.deepEqual(p.unchanged.map((a) => a.coshareUUID), ["b"]);
});

test("a reference's targets are compared by type, so a target's new version is no difference", () => {
  assert.deepEqual(schemaDifferences(schema, liveOf({ ref: { coshareRefSchemaIds: ["seat-uuid-2"] } }), typesOf), []);
});

test("the attribute plan names what a new version adds, removes and changes", () => {
  const live = [{ ...liveOf()[0] }, { ...text, coshareName: "markdown" }];
  assert.deepEqual(attributePlan(schema, live, typesOf), { added: ["kind"], removed: ["markdown"], changed: [] });
  assert.deepEqual(attributePlan(schema, liveOf({ text: { coshareRequired: true } }), typesOf), { added: [], removed: [], changed: [{ name: "kind", what: ["coshareRequired"] }] });
});

test("a new version takes the bump of the segment the unit's version moved, a patch when it did not move", () => {
  assert.equal(bumpOf("v0.71.0", "v0.72.0"), "MINOR");
  assert.equal(bumpOf("v0.71.3", "v0.72.0"), "MINOR");
  assert.equal(bumpOf("v0.71.0", "v1.0.0"), "MAJOR");
  assert.equal(bumpOf("v0.71.0", "v0.71.1"), "PATCH");
  assert.equal(bumpOf("v0.71.0", "v0.71.0"), "PATCH");
  assert.equal(bumpOf("v0.71.1", "v0.71.0"), "PATCH");
});

test("a tenant's version holds a unit's when it is the same or a later patch of it", () => {
  assert.equal(versionHolds("v0.71.0", "v0.71.0"), true);
  assert.equal(versionHolds("v0.71.2", "v0.71.0"), true);
  assert.equal(versionHolds("v0.71.0", "v0.71.1"), false);
  assert.equal(versionHolds("v0.72.0", "v0.71.0"), false);
});

test("a reference sent to a draft points at the current schema of each target type", () => {
  const a = withTargets({ ...ref, coshareRefSchemaId: "vocab-seat", coshareRefSchemaIds: ["vocab-seat", "vocab-role"], coshareRefSchemaTypes: ["cg_seat", "cg_role"] }, (t) => ({ cg_seat: "seat-now", cg_role: "role-now" })[t]);
  assert.equal(a.coshareRefSchemaId, "seat-now");
  assert.deepEqual(a.coshareRefSchemaIds, ["seat-now", "role-now"]);
  assert.deepEqual(withTargets(text, () => "x"), text);
});
