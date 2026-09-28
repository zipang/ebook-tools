# Extract and reformat PDF and EPUB documents

This project turns digital PDF and EPUB files into editable Markdown projects. It serves a document project as local HTML, builds static HTML or PDF, removes units, and translates a document project into another language.

The project is a set of services. The command line calls those services, and a future Web UI calls the same services. The services return plain data and never write to the terminal, so every user interface reports results the same way.

## Services

Each service is one function under `src/commands/`. It takes plain values, including the repository root, and returns a plain result object.

| Service | Source | Purpose |
|---|---|---|
| `extract` | `src/commands/extract.ts` | Turn one document into a document project |
| `serve` | `src/commands/serve.ts` | Serve one document project as local HTML |
| `build` | `src/commands/build.ts` | Write static HTML or PDF output |
| `delete` | `src/commands/delete.ts` | Remove units and renumber the rest |
| `translate` | `src/commands/translate.ts` | Write a translated sibling document project |

### extract

The service reads one document, or every supported document under `sources/`, and writes one document project per document.

```ts
import { runExtract } from "./src/commands/extract.ts";

const result = await runExtract({ input: "sources/books/example.epub" }, process.cwd());

result.documents;    // One result per written project
result.failures;     // Sources that failed, with the reason
result.skippedPaths; // Sources the command ignored
```

### serve

The service starts a local server for one document project and returns the running server with its address.

```ts
import { runServe } from "./src/commands/serve.ts";

const { server, url } = await runServe({ document: "example-book", port: 3000 }, process.cwd());

console.log(url);
server.stop(true);
```

### build

The service writes static HTML or a PDF, and returns the files it wrote with the images it could not place.

```ts
import { runBuild } from "./src/commands/build.ts";

const result = await runBuild(
  {
    repositoryRoot: process.cwd(),
    documentName: "example-book",
    format: "pdf",
    out: "generated/pdf"
  },
);

result.files;         // Every file the command wrote
result.skippedImages; // Images the renderer could not place
```

### delete

The service removes the numbered units, renumbers the rest, and removes images that no unit references. The write is atomic, so a failure leaves the project unchanged.

```ts
import { runDelete } from "./src/commands/delete.ts";

const result = await runDelete({
  repositoryRoot: process.cwd(),
  documentName: "example-book",
  parts: [1, 3, 8]
});

result.removedTitles;
result.remainingCount;
```

### translate

The service calls a model once per Markdown unit, validates every answer against the source structure, and writes a standalone sibling project. It returns a summary with the counts, the cost, and the duration.

```ts
import { runTranslate } from "./src/commands/translate.ts";

const result = await runTranslate(
  {
    document: "example-book",
    to: "fr",
    force: false,
    cache: true,
    bestEffort: false
  },
  process.cwd()
);

result.translated;
result.failed;
result.costUsd;
```

## Call the services from the command line

The command line is an adapter over the services. Run these commands from the repository root.

### Extract one source

```bash
bun run extract -- --input sources/books/example.epub --document example-book
```

The `--document` option names the document project. It is optional. Without it, the service derives a safe name from the filename. Use `--force` to replace an existing document project.

### Extract the source library

```bash
bun run extract -- --all
```

The command scans `sources/` recursively. It creates one document project under `documents/<document-name>/` for each supported document. Nested files with the same derived name cause a collision error.

### Preview a document project

```bash
bun run serve -- --document example-book --port 3000
```

Open `http://127.0.0.1:3000/`. The server reads the current Markdown and image files for every request. The server binds to `127.0.0.1` by default.

### Build HTML

```bash
bun run build -- --document example-book --format html --out generated/html
```

The command writes `index.html`, ordered files under `chapters/`, and a copy of local assets under `assets/`.

### Build PDF

```bash
bun run build -- --document example-book --format pdf --out generated/pdf
```

The command writes `document.pdf` locally. It uses the same semantic content and editorial theme as HTML output. An image that the renderer cannot place is reported on standard error.

### Delete units

```bash
bun run delete -- --document example-book --parts 1 3 8
```

The command removes the numbered units. The numbers start at 1 and follow the index order. The remaining units keep their order and get new numbers that close the gaps. Internal links update to the new unit numbers. A link to a removed unit becomes `(#)`. Images that no unit references are removed. At least one unit must remain.

### Translate one document project

```bash
# Estimate the cost without calling a model
bun run translate -- --document example-book --to fr --dry-run

# Translate into a sibling project documents/example-book-fr/
bun run translate -- --document example-book --to fr

# Choose a model, bound the parallelism, and cap the cost
bun run translate -- --document example-book --to fr --model deepseek-v4.1-flash --concurrency 4 --max-cost 2

# Translate a subset and copy the remaining units from the source
bun run translate -- --document example-book --to fr --only 3 4 5

# Write the Markdown report to another path
bun run translate -- --document example-book --to fr --report reports/review.md

# Print a machine-readable summary
bun run translate -- --document example-book --to fr --json

# Replace an existing translated project
bun run translate -- --document example-book --to fr --force
```

`translate` reads one document project and writes a standalone sibling project `documents/<document-name>-<lang>/`. The sibling project keeps the unit ids, unit paths, images, and templates of the source, so `serve` and `build` accept it without any change. A structure violation is never retried. The unit is marked failed, and the run returns a non-zero exit code, unless `--best-effort` copies the failed units from the source.

Model access uses the OpenCode Zen gateway. Export `OPENCODE_API_KEY` before a run. `OPENCODE_ZEN_BASE_URL` overrides the default `https://opencode.ai/zen/v1`. The models are declared in `src/translate/providers/registry.ts` with their endpoint family and price.

Per-unit results are cached in `reports/translation.cache.json`, so a rerun skips unchanged units. The cache is written even when some units fail, so a retry does not pay twice for the units that succeeded. The reports land in `reports/translation.md` and `reports/translation.json`, or at the path given by `--report`.

`--max-cost` is a safety ceiling, not a hard limit. The pool starts several calls before any of them reports a cost. A run can therefore exceed the ceiling by the cost of the calls already in flight. The summary reports the real spend.

### Compare translation models

The model comparison tool is a one-off experiment. It lives in `scripts/benchmark-translate.ts` and is not part of the shipped command line. It chose the default translation model. Use it again only to compare new candidates.

```bash
# List the candidate models, units, and estimated cost without calling a model
bun scripts/benchmark-translate.ts --document example-book --to fr --only 11 --dry-run

# Run every candidate on selected units and write a review report
bun scripts/benchmark-translate.ts --document example-book --to fr --only 11
```

The tool runs one candidate at a time at concurrency 1, so the duration is comparable. It stores the translated Markdown of every model under `roadmap/T0002/benchmark-output/<model>/`. It copies the source images next to them. It writes `roadmap/T0002/benchmark.md` with the details, the summary tables, the measured time, and the cost. The tool never fills the quality columns. A human reviewer opens each stored translation, writes a `Quality /10`, and fills the average and the verdict. `roadmap/T0002/benchmark.json` holds the raw rows.

## Requirements

- Bun 1.4 or later.
- A digital PDF or an unencrypted EPUB 2 or EPUB 3 file.

Scanned PDFs, OCR, DRM-protected files, and EPUB output are not included. Translation needs an `OPENCODE_API_KEY` and sends the document text to a third-party model.

## Install

```bash
bun install
```

## Project layout

```text
sources/                         The documents: original PDF and EPUB files
documents/                       The document projects
  <document-name>/
    manifest.json                Ordered unit and asset index
    chapters/                    Editable Markdown units
    assets/images/               Local extracted images
    templates/                   Document HTML and print theme
    reports/                     Human and machine extraction reports
    generated/                   Disposable HTML and PDF output
src/
  commands/                      The services, one file per service
  services/document.ts           Document loading, shared by every caller
  extract/                       EPUB and PDF source adapters
  translate/                     Translation, validation, caching, reporting
  model/                         Manifest and content types, no file access
  shared/                        Errors, paths, templates, escaping, images
  render/                        HTML and PDF rendering
  server/                        The local preview server
  cli.ts                         The command-line adapter
scripts/                         One-off tools, such as the model benchmark
tests/                           Fixtures, and the unit tests kept from before
roadmap/                         One directory per ticket, with its spec and plan
```

The folder name `documents/` holds document projects, not documents. A document stays in `sources/`, and the project beside it in `documents/` is the editable form of that document.

The source is layered. A module imports from the layers below it and never from a layer above it. `src/AGENTS.md` states the rule for agents.

## Editable content

Edit the Markdown files under `chapters/`. Keep image links relative to the document project. The manifest controls unit order, titles, language, and source locations. Re-run `serve` or `build` after editing.

The extraction report identifies uncertain reading order, missing resources, dropped regions, and image conversion issues. Review the report before treating extracted content as final.

## Development

```bash
bun test
bun test --coverage
bun run lint
bun run typecheck
bunx biome check --write <files>
```

A test file sits beside the file it tests and carries the same base name, as `src/commands/translate.test.ts` sits beside `src/commands/translate.ts`. Write unit tests for the services. The command line and the server are not unit tested.

The project uses tabs in source files and two spaces in Markdown. Do not commit source books or generated output.

## Glossary

- **Document:** The original file under `sources/`, either a digital PDF or an unencrypted EPUB. The command line calls it a source. One document produces exactly one document project.
- **Document project:** The editable folder under `documents/<document-name>/` for one document. It holds Markdown, images, and templates, not the original file.
- **Unit:** One ordered Markdown section of a document project, such as one EPUB spine item or one detected PDF section.
- **Service:** One function that performs one task and returns plain data. A service never writes to the terminal and never starts a server.
- **Adapter:** A user interface over the services. The command line and the preview server are adapters, and a future Web UI is one too.
- **Extraction report:** A record of extracted counts, source locations, warnings, and resource status.
- **Generated output:** HTML or PDF files that can be deleted and recreated from Markdown and assets.
