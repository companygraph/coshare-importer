// The PUT body sync sends for a changed page, without a tenant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { putBody } from "../lib/write.mjs";

const refAttrs = [
  { coshareName: "kind", coshareType: "REFERENCE", coshareCardinality: "ONE" },
  { coshareName: "bears_on", coshareType: "REFERENCE", coshareCardinality: "many" },
  { coshareName: "replaces", coshareType: "REFERENCE", coshareCardinality: "many" },
];
const link = (attribute, refId, properties) => ({ attribute, relationshipType: attribute.toUpperCase(), refId, refLabel: refId.toUpperCase(), refSchemaType: "cg_seat", refOriginUUID: refId, ...(properties ? { properties } : {}) });

test("a PUT carries the values and the whole link set, each link with its properties", () => {
  const artifact = { attributes: { name: "A call", tagline: null, markdown: "# A call" }, references: [link("kind", "k"), link("bears_on", "o", { row: "1" }), link("bears_on", "o", { row: "3" })] };
  assert.deepEqual(putBody(artifact, refAttrs), {
    name: "A call", markdown: "# A call",
    kind: { refId: "k", refLabel: "K" },
    bears_on: [{ refId: "o", refLabel: "O", properties: { row: "1" } }, { refId: "o", refLabel: "O", properties: { row: "3" } }],
    replaces: [],
  });
});

test("a PUT nests a grouped reference under its group, beside the group's values", () => {
  const grouped = [{ ...refAttrs[0], group: null }, { ...refAttrs[1], group: "bears_on" }, { ...refAttrs[2], group: "history" }];
  const artifact = { attributes: { name: "A call", bears_on: { bears_on_text: "| a |" }, companygraph: { unmapped: null, address: "x" } }, references: [link("kind", "k"), link("bears_on", "o", { row: "1" })] };
  assert.deepEqual(putBody(artifact, grouped), {
    name: "A call", companygraph: { address: "x" },
    kind: { refId: "k", refLabel: "K" },
    bears_on: { bears_on_text: "| a |", bears_on: [{ refId: "o", refLabel: "O", properties: { row: "1" } }] },
    history: { replaces: [] },
  });
});
