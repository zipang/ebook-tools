# Extract and reformat PDF and EPUB documents

This project extracts digital PDF and EPUB files into editable Markdown projects. It serves a selected document as local HTML and builds static HTML or PDF output. The content model stays language-neutral for later translation work.

## Requirements

- Bun 1.4 or later.
- A digital PDF or an unencrypted EPUB 2 or EPUB 3 file.

Scanned PDFs, OCR, DRM-protected files, automated translation, and EPUB output are not included in the first release.

## Install

```bash
bun install
```

## Commands

Run these commands from the repository root.

### Extract one source

```bash
bun run extract -- --input sources/books/example.epub --document example-book
```

The `--document` option is optional. Without it, the extractor derives a safe directory name from the source filename. Use `--force` to replace an existing document project.

### Extract the source library

```bash
bun run extract -- --all
```

The command scans `sources/` recursively. It creates one project under `documents/<document-name>/` for each supported source. Nested files with the same derived name cause a collision error.

### Preview a document

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

The command writes `document.pdf` locally. It uses the same semantic content and editorial theme as HTML output.

### Delete units

```bash
bun run delete -- --document example-book --parts 1 3 8
```

The command removes the numbered units. The numbers start at 1 and follow the index order. The remaining units keep their order and get new numbers that close the gaps. Internal links update to the new unit numbers. Images that no unit references are removed. At least one unit must remain.

## Project layout

```text
sources/                         Original PDF and EPUB files
documents/
  <document-name>/
    manifest.json                Ordered unit and asset index
    chapters/                    Editable Markdown units
    assets/images/               Local extracted images
    templates/                   Document HTML and print theme
    reports/                     Human and machine extraction reports
    generated/                   Disposable HTML and PDF output
src/                             Bun and TypeScript source
tests/                           Unit, integration, and fixture tests
roadmap/T0001/                   Approved specification and plan
```

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

The project uses tabs in source files and two spaces in Markdown. Do not commit source books or generated output.

## Glossary

- **Document project:** The editable folder under `documents/<document-name>/` for one source document.
- **Unit:** One ordered Markdown section, such as an EPUB spine document or a detected PDF section.
- **Extraction report:** A record of extracted counts, source locations, warnings, and resource status.
- **Generated output:** HTML or PDF files that can be deleted and recreated from Markdown and assets.
