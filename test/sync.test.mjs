// The sync's plan and its schema comparison, without a tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planArtifacts, schemaDifferences } from "../lib/sync.mjs";

const art = (id, markdown) => ({ coshareUUID: id, coshareType: "cg_seat", attributes: { address: `seats/${id}`, markdown } });

test("a sync imports what is new, writes what changed, deletes what is gone and leaves the rest", () => {
  const live = new Map([["a", { type: "cg_seat", markdown: "same" }], ["b", { type: "cg_seat", markdown: "old" }], ["c", { type: "cg_seat", markdown: "gone" }]]);
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
const targetsOf = () => ["seat-uuid"];

test("a schema the tenant holds as it is shows no difference, case of cardinality aside", () => {
  assert.deepEqual(schemaDifferences(schema, liveOf(), targetsOf), []);
});

test("a schema that changed names each attribute and what changed in it", () => {
  assert.deepEqual(schemaDifferences(schema, liveOf({ ref: { coshareRefSchemaIds: ["other-uuid"] } }), targetsOf), ["cg_decision.by: targets differ"]);
  assert.deepEqual(schemaDifferences(schema, liveOf({ text: { cosharePrivacy: 2, coshareValidators: [] } }), targetsOf), ["cg_decision.kind: cosharePrivacy, allowed values differ"]);
  assert.deepEqual(schemaDifferences(schema, [liveOf()[0]], targetsOf), ["cg_decision.kind is new"]);
  assert.deepEqual(schemaDifferences({ ...schema, attributes: [ref] }, liveOf(), targetsOf), ["cg_decision.kind is gone"]);
});
