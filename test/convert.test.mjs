// The converter over a small instance that meta-model's own init writes, plus five pages.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { convert, report, typeName } from "../lib/convert.mjs";

let root;
const id = (n) => `01a21686-0000-7000-8000-${String(n).padStart(12, "0")}`;
const page = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, "model", rel)), { recursive: true }); fs.writeFileSync(path.join(root, "model", rel), text); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "coshare-importer-"));
  const bin = path.join(path.dirname(createRequire(import.meta.url).resolve("@companygraph/meta-model/instance")), "..", "bin", "companygraph.mjs");
  execFileSync("git", ["init", "-q", root]);
  execFileSync(process.execPath, [bin, "init", root, "--here", "--name", "Fixture", "--pack", "organization", "--gate", "none", "--no-hook"], { cwd: root, stdio: "ignore" });
  page("seats/owner.md", `---\nid: ${id(1)}\nsource: Local\n---\n\n# Owner\n\n> Answers for the company.\n`);
  page("seats/writer.md", `---\nid: ${id(2)}\nsource: Local\n---\n\n# Writer\n\n> Writes the English.\n`);
  page("decision-kinds/vocabulary.md", `---\nid: ${id(3)}\nsource: Local\n---\n\n# Vocabulary\n\n> A call about the words.\n\n## What it means\n\nThe words a model uses.\n`);
  page("decision-statuses/standing.md", `---\nid: ${id(4)}\nsource: Local\n---\n\n# Standing\n\n> The call holds.\n\n## What it means\n\nIt holds.\n`);
  page("decisions/2026-one-voice.md", `---\nid: ${id(5)}\nsource: Local\ndecided: 2026-11-01\nkind: Vocabulary\nstatus: Standing\nby: Owner\n---\n\n# The company writes in one voice\n\n> We write every page in one voice.\n\n## The question\n\nWhich voice.\n\n## Alternatives\n\n| Option | Why not |\n| --- | --- |\n| Many voices | A reader cannot tell who speaks |\n\n## Why\n\nOne reader.\n\n## Consequences\n\nEvery page is edited.\n\n## Bears on\n\n| Type | Entity | Owner | How |\n| --- | --- | --- | --- |\n| seat | Owner |  | made it |\n| decision-kind | Vocabulary |  | changed it |\n| seat | Owner |  | ended it |\n| seat | Writer |  | changed it |\n`);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const decisionOf = (r) => r.artifacts.find((a) => a.coshareType === "cg_decision");

test("every type the vocabulary declares becomes a schema at its unit's version", () => {
  const r = convert(root);
  const core = JSON.parse(fs.readFileSync(path.join(root, "meta", "core", "manifest.json"), "utf8")).version;
  const decision = r.schemas.find((s) => s.coshareType === "cg_decision");
  assert.equal(decision.coshareVersion, `v${core}`);
  assert.equal(decision.coshareCategory, "companygraph-core");
  const files = ["core", "organization"].flatMap((unit) => fs.readdirSync(path.join(root, "meta", unit)).filter((f) => f.endsWith("-schema.md")));
  assert.equal(r.schemas.length, files.length);
  for (const s of r.schemas) {
    assert.match(s.coshareType, /^cg_[a-z0-9_]+$/);
    assert.doesNotMatch(s.coshareType, /coshare/i);
    const names = s.attributes.map((a) => a.coshareName);
    assert.equal(new Set(names).size, names.length, `${s.coshareType} names an attribute twice`);
    assert.ok(s.attributes.every((a) => a.coshareType !== "TEXT"), `${s.coshareType} uses TEXT, which CoShare refuses`);
  }
});

test("an enum field carries its tokens as ALLOWED_VALUES", () => {
  const kind = convert(root).schemas.find((s) => s.coshareType === "cg_control").attributes.find((a) => a.coshareName === "kind");
  assert.deepEqual(kind.coshareValidators, [{ coshareType: "ALLOWED_VALUES", value: ["preventive", "detective", "corrective"] }]);
});

test("a page becomes an artifact with its id, its whole text and its links", () => {
  const d = decisionOf(convert(root));
  assert.equal(d.coshareUUID, id(5));
  assert.equal(d.attributes.companygraph_id, id(5));
  assert.equal(d.attributes.address, "decisions/2026-one-voice");
  assert.match(d.attributes.markdown, /^---\nid: /);
  assert.equal(d.attributes.decided, "2026-11-01");
  assert.deepEqual({ refId: d.attributes.kind.refId, refLabel: d.attributes.kind.refLabel }, { refId: id(3), refLabel: "Vocabulary" });
  assert.match(d.attributes.alternatives, /\| Many voices \| A reader cannot tell who speaks \|/);
});

test("a table link carries its row and the row's other cells", () => {
  const bears = decisionOf(convert(root)).attributes.bears_on;
  const writer = bears.find((l) => l.refLabel === "Writer");
  assert.deepEqual(writer.properties, { row: "4", type: "seat", owner: "", how: "changed it" });
});

test("two rows naming one entity become one link that keeps both rows", () => {
  const r = convert(root);
  const owner = decisionOf(r).attributes.bears_on.filter((l) => l.refLabel === "Owner");
  assert.equal(owner.length, 1);
  assert.deepEqual(owner[0].properties, { row: "1, 3", type: "seat\nseat", owner: "\n", how: "made it\nended it" });
  assert.equal(r.counts.merged, 1);
});

test("a reference to any type lists the types the model reaches, for the loader to set", () => {
  const r = convert(root);
  const bears = r.schemas.find((s) => s.coshareType === "cg_decision").attributes.find((a) => a.coshareName === "bears_on");
  assert.equal(bears.coshareRefSchemaType, "cg_seat"); // the most used first
  assert.equal(bears.coshareRefSchemaIds.length, 1); // the import resolves only the first
  assert.deepEqual(r.targets.find((t) => t.type === "cg_decision"), { type: "cg_decision", attribute: "bears_on", targets: ["cg_seat", "cg_decision_kind"] });
});

test("over CoShare's cap, a reference splits into one attribute per type with one relationship type", () => {
  const r = convert(root, { maxTargets: 1 });
  const refs = r.schemas.find((s) => s.coshareType === "cg_decision").attributes.filter((a) => a.coshareName.startsWith("bears_on_") && a.coshareType === "REFERENCE");
  assert.deepEqual(refs.map((a) => [a.coshareName, a.coshareRefSchemaType, a.coshareRelationshipType]), [["bears_on_seat", "cg_seat", "BEARS_ON"], ["bears_on_decision_kind", "cg_decision_kind", "BEARS_ON"]]);
  const d = decisionOf(r);
  assert.deepEqual(d.attributes.bears_on_decision_kind.map((l) => l.refLabel), ["Vocabulary"]);
  assert.equal(r.targets.find((t) => t.type === "cg_decision"), undefined);
});

test("only the named types are converted, and the report counts what was", () => {
  const r = convert(root, { only: ["decision", "seat"] });
  assert.deepEqual(r.schemas.map((s) => s.coshareType).sort(), ["cg_decision", "cg_seat"]);
  assert.deepEqual([...new Set(r.artifacts.map((a) => a.coshareType))].sort(), [typeName("decision"), typeName("seat")]);
  assert.match(report(r), /\| Artifacts, one per page \| 3 \|/);
});

test("a person's attributes are personal, a reference to a person identifies one indirectly, the rest is not personal", () => {
  const r = convert(root);
  const attrs = (type) => r.schemas.find((s) => s.coshareType === type).attributes;
  assert.ok(attrs("cg_profile").every((a) => a.cosharePrivacy === 2), "a profile attribute is not personal");
  assert.ok(attrs("cg_experience").every((a) => a.cosharePrivacy === 2), "an experience, owned by a profile, is not personal");
  assert.equal(attrs("cg_group").find((a) => a.coshareName === "people").cosharePrivacy, 1);
  assert.ok(attrs("cg_decision").every((a) => a.cosharePrivacy === 0));
  assert.ok(r.schemas.every((s) => s.attributes.every((a) => !("coshareConfidentiality" in a))), "confidentiality was set without being asked");
});

test("confidentiality is one level for every attribute, and only 0 to 3", () => {
  const r = convert(root, { confidentiality: 0 });
  assert.ok(r.schemas.every((s) => s.attributes.every((a) => a.coshareConfidentiality === 0)));
  assert.ok(r.schemas.every((s) => s.attributes.every((a) => !("targetTypes" in a) && !("section" in a))), "a working field leaked into a bundle");
  assert.throws(() => convert(root, { confidentiality: 4 }), /0, 1, 2 or 3/);
});
