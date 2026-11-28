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
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "The fixture"]);
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

const decisionOf = (r) => r.artifacts.find((a) => a.coshareType === "cg_decision");
const linksOf = (a, attribute) => a.references.filter((l) => l.attribute === attribute);

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
  }
  const attrs = r.schemas.find((s) => s.coshareType === "cg_decision").attributes;
  const type = (n) => attrs.find((a) => a.coshareName === n).coshareType;
  assert.deepEqual(["markdown", "tagline", "why", "alternatives", "name", "address"].map(type), ["TEXT", "TEXT", "TEXT", "TEXT", "STRING", "STRING"]);
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
  assert.deepEqual(linksOf(d, "kind"), [{ attribute: "kind", relationshipType: "KIND", refId: id(3), refLabel: "Vocabulary", refSchemaType: "cg_decision_kind", refOriginUUID: id(3) }]);
  assert.ok(Object.values(d.attributes).every((v) => !v || typeof v !== "object" || Array.isArray(v)), "a link was left among the attributes");
  assert.match(d.attributes.alternatives, /\| Many voices \| A reader cannot tell who speaks \|/);
});

test("a table link carries its row and the row's other cells", () => {
  const writer = linksOf(decisionOf(convert(root)), "bears_on").find((l) => l.refLabel === "Writer");
  assert.deepEqual(writer.properties, { row: "4", type: "seat", owner: "", how: "changed it" });
});

test("two rows naming one entity are two links, each with its own row", () => {
  const r = convert(root);
  const owner = linksOf(decisionOf(r), "bears_on").filter((l) => l.refLabel === "Owner");
  assert.deepEqual(owner.map((l) => l.properties), [{ row: "1", type: "seat", owner: "", how: "made it" }, { row: "3", type: "seat", owner: "", how: "ended it" }]);
  const bears = r.schemas.find((s) => s.coshareType === "cg_decision").attributes.find((a) => a.coshareName === "bears_on");
  assert.equal(bears.coshareRefRepeatable, true);
  assert.equal(r.counts.links, decisionOf(r).references.length + r.artifacts.filter((a) => a !== decisionOf(r)).reduce((n, a) => n + a.references.length, 0));
});

test("a reference to any type names every type the model reaches, by UUID and by name", () => {
  const r = convert(root);
  const bears = r.schemas.find((s) => s.coshareType === "cg_decision").attributes.find((a) => a.coshareName === "bears_on");
  const uuidOf = (t) => r.schemas.find((s) => s.coshareType === t).coshareUUID;
  assert.equal(bears.coshareRefSchemaType, "cg_seat"); // the most used first
  assert.deepEqual(bears.coshareRefSchemaTypes, ["cg_seat", "cg_decision_kind"]);
  assert.deepEqual(bears.coshareRefSchemaIds, ["cg_seat", "cg_decision_kind"].map(uuidOf));
  assert.equal(bears.coshareRefSchemaId, uuidOf("cg_seat"));
});

test("a value longer than CoShare's TEXT limit is named as a loose end", () => {
  const file = path.join(root, "model", "decisions", "2026-one-voice.md");
  const committed = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, committed.replace("One reader.", "x".repeat(30001)));
  try {
    assert.ok(convert(root).losses.some((l) => /decisions\/2026-one-voice: `why` is 30001 characters/.test(l)));
    assert.ok(convert(root).losses.some((l) => /decisions\/2026-one-voice: `markdown` is \d+ characters/.test(l)));
  } finally {
    fs.writeFileSync(file, committed);
  }
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

test("--commit reads the instance as it was committed, not its working copy", () => {
  const file = path.join(root, "model", "decisions", "2026-one-voice.md");
  const committed = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, committed.replace("One reader.", "One reader, edited."));
  try {
    const now = decisionOf(convert(root)), then = convert(root, { commit: "HEAD" });
    assert.match(now.attributes.markdown, /One reader, edited\./);
    assert.equal(decisionOf(then).attributes.markdown, committed);
    assert.equal(then.commit, execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim());
    assert.throws(() => convert(root, { commit: "no-such-ref" }), /has no commit no-such-ref/);
  } finally {
    fs.writeFileSync(file, committed);
  }
});
