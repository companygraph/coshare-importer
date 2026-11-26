<!-- conventions · v1.61.0 -->
Shared conventions of the robertblust, guestgraph and companygraph organizations live in `conventions/`, vendored from robertblust/conventions at the release `conventions.json` names. Read them before writing or committing anything here.

- `conventions/WRITING.md` — how we write: one voice, three registers, English and German.
- `conventions/WORKING.md` — how we work with git and GitHub.
- `conventions/REPOSITORIES.md` — the family: what each repository is and what pins what.
- `conventions/PINS.md` — what a member pins and how the family resync moves it.
- `conventions/WRITER.md`, `conventions/TRANSLATOR.md`, `conventions/EDITOR.md`,
  `conventions/BACKREADER.md`, `conventions/GLOSSARY.md`, `conventions/GERMAN.md` — the four roles
  that make a text, the terms they keep and the German they write.

Everything below this block is this repository's own. `sh conventions/conventions-sync check` says whether the copy matches the release, `sync` brings it to the release the pin names, and `sh conventions/conventions-check` holds this repository's own Markdown to `WRITING.md`, and `sh conventions/conventions-format` to its one form, which `fix` writes. Edit a shared file in robertblust/conventions, never here.
<!-- end conventions -->

## This repository

The CoShare importer: it reads a CompanyGraph instance with `companygraph/meta-model`, at the release `package.json` pins, and loads it into a CoShare tenant as schemas, artifacts and links. One pin besides the conventions, moved only in a pull request: `package.json` names the parser's release. `lib/` converts and talks to CoShare, `bin/` holds the four commands, convert, load, verify and reset, and `docs/coshare.md` records what CoShare does and what the importer does about it; read it before changing how a load runs. The required checks on `main` are `conventions / conventions` and `test / test`. A load writes to a tenant: it needs a token in `COSHARE_JWT`, and it is run by hand, never by CI. Nothing here commits to an instance.
