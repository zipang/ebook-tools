# Implementation Plan: T0001 — Local PDF and EPUB Extraction and Publishing Pipeline

**Ticket:** T0001  
**Title:** Local PDF and EPUB Extraction and Publishing Pipeline  
**Phase:** Implement  
**Status:** Implemented - awaiting final review  
**Specification:** `roadmap/T0001/spec.md`

## Overview

Build a local Bun and TypeScript command-line toolchain for a multi-document library. The tool extracts digital PDFs and EPUBs from `sources/` into independent projects under `documents/`, previews one selected document through a local `bun.serve()` server, and renders HTML and PDF output from editable Markdown. The implementation uses vertical slices so that each phase produces a testable path from source content to readable output.

## Architecture Decisions

- Use a framework-independent intermediate document model. EPUB and PDF adapters produce the same typed document units.
- Keep the repository file-based. The manifest, Markdown units, local images, reports, templates, and generated output remain separate and inspectable.
- Treat `sources/` as read-only input. Recursive source discovery supports the existing nested source folders.
- Derive one safe document directory name per source. Never merge content from different source files.
- Use Commander for the CLI. Keep command handlers thin and place extraction, writing, rendering, and serving logic in importable modules.
- Use HTML and CSS templates for both preview and PDF output. Keep typography in configurable theme values.
- Sanitize source and Markdown HTML before rendering. Reject filesystem paths outside the selected document directory.
- Use PDFKit as the local HTML-to-PDF adapter. `Bun.WebView` print is unavailable without a local Chrome installation, so PDFKit renders the sanitized semantic HTML with a fixed editorial print layout.
- Use small generated fixtures for automated tests. Use the files in `sources/` only for local manual verification. Do not commit source books.
- Require explicit approval before adding parser, sanitizer, archive, browser, or PDF dependencies. Record the selected versions in `package.json` and the Bun lockfile.

## Dependency Graph

```text
Bun toolchain and dependency decisions
              |
              v
Domain model, manifest, paths, and errors
              |
      +-------+------------------+
      |                          |
      v                          v
Markdown writer and reports   Markdown-to-HTML safety layer
      |                          |
      +-------+------------------+
              |
        +-----+------+
        |            |
        v            v
   EPUB adapter   PDF adapter
        |            |
        +-----+------+
              |
              v
Per-file and batch extraction
              |
              v
HTML templates and preview server -----> HTML build
              |                                  |
              +------------------+---------------+
                                 v
                           PDF export
                                 |
                                 v
                    End-to-end acceptance
```

## Implementation Order

1. Establish the Bun toolchain and dependency boundaries.
2. Define the shared document and document-project contracts.
3. Make the Markdown writer and project reports testable.
4. Implement EPUB and PDF extraction in parallel after the shared contract is stable.
5. Add per-file and batch extraction.
6. Add safe HTML rendering and the default editorial template.
7. Add the document preview server and build command.
8. Run end-to-end acceptance checks and document the public commands.

## Task List

### Phase 1: Foundation

- [x] **Task 1: Bootstrap the Bun project and dependency boundaries**
  - Acceptance: The repository has a root Bun package with `extract`, `serve`, `build`, `test`, `lint`, and `typecheck` scripts. Commander is the only approved CLI dependency. Parser, sanitizer, archive, and PDF choices are recorded before implementation. Source files and generated output have ignore rules. Existing Biome and EditorConfig rules remain active.
  - Verify: Run `bun install`, `bun test`, `bun run lint`, and `bun run typecheck`. Confirm the lockfile and package scripts are reproducible.
  - Files: `package.json`, `bun.lock`, `tsconfig.json`, `.gitignore`, `biome.jsonc`
  - Depends: None
  - Scope: Medium

- [x] **Task 2: Define the document model and document-project contracts**
  - Acceptance: Define typed document units, semantic blocks, source locations, image references, extraction warnings, manifest metadata, and report codes. Validate the manifest schema. Reject unsafe document names, path traversal, and out-of-root asset paths. Support recursive source paths and deterministic filename slugs.
  - Verify: Run `bun test tests/unit/model.test.ts` and `bun run typecheck`. Add table-driven tests for valid and invalid manifests and paths.
  - Files: `src/model/document.ts`, `src/model/project.ts`, `src/extract/common.ts`, `src/shared/paths.ts`, `tests/unit/model.test.ts`
  - Depends: Task 1
  - Scope: Medium

- [x] **Task 3: Write Markdown units, assets, and extraction reports atomically**
  - Acceptance: Serialize the shared model to semantic UTF-8 Markdown. Write the specified `manifest.json`, `chapters/`, `assets/images/`, `templates/`, `reports/`, and `generated/` structure. Rewrite image references as relative local links. Write human and machine reports. Replace a target only after all files are ready. Refuse an existing non-empty document by default unless an explicit overwrite option is supplied.
  - Verify: Run `bun test tests/unit/writer.test.ts`. Check a temporary project for valid paths, report content, atomic failure behavior, and no temporary links.
  - Files: `src/markdown/serialize.ts`, `src/extract/writer.ts`, `src/shared/report.ts`, `tests/unit/writer.test.ts`
  - Depends: Task 2
  - Scope: Medium

### Checkpoint: Foundation

- [x] The toolchain installs and runs on Bun.
- [x] The shared model and manifest contract compile.
- [x] The writer produces a valid isolated document directory.
- [ ] The human reviews the model and target-overwrite policy before adapter work.

### Phase 2: Source Extraction

- [x] **Task 4: Implement the EPUB extraction adapter**
  - Acceptance: Read EPUB 2 and EPUB 3 package metadata and spine order. Map spine XHTML documents to ordered Markdown units. Convert semantic HTML to Markdown. Extract and resolve image resources. Record unresolved resources and unsupported structures. Reject encrypted or malformed packages with actionable errors.
  - Verify: Run `bun test tests/unit/epub.test.ts`. Test a generated multi-chapter EPUB and manually inspect the nested source EPUB in `sources/`. Compare spine order, links, images, and warnings.
  - Files: `src/extract/epub.ts`, `tests/unit/epub.test.ts`, `tests/fixtures/epub/make-fixture.ts`
  - Depends: Tasks 2 and 3
  - Scope: Medium

- [x] **Task 5: Implement the digital PDF extraction adapter**
  - Acceptance: Read selectable PDF text and embedded images. Detect reliable headings and section boundaries. Create split units only with sufficient evidence. Use one continuous unit when structure is ambiguous. Record page ranges, confidence, empty regions, and unresolved resources. Never invoke OCR.
  - Verify: Run `bun test tests/unit/pdf.test.ts`. Test a generated PDF with a section boundary and an ambiguous PDF. Manually inspect the PDF in `sources/` and review its report.
  - Files: `src/extract/pdf.ts`, `tests/unit/pdf.test.ts`, `tests/fixtures/pdf/make-fixture.ts`
  - Depends: Tasks 2 and 3
  - Scope: Medium

- [x] **Task 6: Add per-file and recursive batch extraction**
  - Acceptance: Implement `extract --input <file> [--document <name>]` and `extract --all`. Recursively discover PDF and EPUB files under `sources/`. Derive safe document names, detect collisions, and keep each project isolated. Process remaining batch files after a failure, report all failures, and return non-zero if any file failed. Never modify source files. Require an explicit overwrite option before replacing a non-empty document.
  - Verify: Run `bun test tests/integration/extract.test.ts`. Use two nested source files, an unknown extension, a name collision, and one intentionally invalid file. Confirm separate `documents/<name>/` directories and correct exit codes.
  - Files: `src/commands/extract.ts`, `src/extract/batch.ts`, `src/shared/source-discovery.ts`, `tests/integration/extract.test.ts`, `src/cli.ts`
  - Depends: Tasks 4 and 5
  - Scope: Medium

### Checkpoint: Source Extraction

- [x] EPUB extraction produces ordered chapter files and local images.
- [x] PDF extraction produces semantic content and explicit uncertainty reports.
- [x] Per-file and batch extraction do not mix documents.
- [ ] The human reviews extraction reports for representative source files.

### Phase 3: Rendering and Preview

- [x] **Task 7: Render Markdown into safe HTML fragments**
  - Acceptance: Parse edited Markdown into semantic HTML. Allow the required document elements. Remove scripts, event handlers, unsafe URLs, and remote resources. Resolve relative image and link paths inside the selected document boundary. Return useful parse errors without crashing the command.
  - Verify: Run `bun test tests/unit/markdown.test.ts`. Test allowed elements, sanitized HTML, missing images, traversal links, tables, code, and block quotes.
  - Files: `src/markdown/parse.ts`, `src/shared/sanitize.ts`, `tests/unit/markdown.test.ts`
  - Depends: Tasks 2 and 3
  - Scope: Medium

- [x] **Task 8: Add the default editorial HTML template**
  - Acceptance: Generate a document index, ordered unit pages, and previous and next links. Use semantic landmarks and headings. Apply configurable typography, line length, spacing, contrast, image scaling, code and table styles, and print page rules. Set the document language and support directionality. Keep project templates independent from Markdown content.
  - Verify: Run `bun test tests/unit/render.test.ts`. Build a fixture project and inspect semantic markup, navigation, responsive layout, print CSS, and language attributes.
  - Files: `src/render/template.ts`, `src/render/html.ts`, `src/templates/default/base.html`, `src/templates/default/print.css`, `tests/unit/render.test.ts`
  - Depends: Task 7
  - Scope: Medium

- [x] **Task 9: Serve one selected document with `bun.serve()`**
  - Acceptance: Implement `serve --document <name> [--host <host>] [--port <port>]`. Resolve the name only under `documents/`. Serve the document index, rendered units, local assets, and `/health`. Read current files for every request. Reject unsafe paths and unknown documents. Return useful `400` and `404` responses. Stop the server cleanly in tests.
  - Verify: Run `bun test tests/integration/serve.test.ts`. Start the command locally and inspect all routes, an edited Markdown file, an image, navigation, and path-traversal requests.
  - Files: `src/server/server.ts`, `src/server/routes.ts`, `src/commands/serve.ts`, `tests/integration/serve.test.ts`
  - Depends: Tasks 2, 7, and 8
  - Scope: Medium

### Checkpoint: Rendering and Preview

- [x] Safe HTML output rejects unsafe source content.
- [x] The default template improves print readability without changing Markdown.
- [x] The local server serves only the selected document.
- [ ] The human reviews the preview in a browser before PDF work.

### Phase 4: Build and Release Readiness

- [x] **Task 10: Add HTML and PDF build commands**
  - Acceptance: Implement `build --document <name> --format html|pdf --out <dir>`. Build units in manifest order. Use the same template and styles for HTML and PDF. Generate a table of contents for multi-unit documents. Create valid local PDF output. Keep generated output disposable and do not require network access.
  - Verify: Run `bun test tests/integration/build.test.ts`. Build both formats, open the HTML, inspect the PDF signature and text, and confirm that deleting `generated/` does not remove source content.
  - Files: `src/commands/build.ts`, `src/render/pdf.ts`, `tests/integration/build.test.ts`
  - Depends: Tasks 7, 8, and 9
  - Scope: Medium

- [x] **Task 11: Run end-to-end acceptance and document the public workflow**
  - Acceptance: Run the complete flow from nested `sources/` files to isolated Markdown, local preview, HTML, and PDF output. Verify source files remain unchanged. Add concise root documentation for commands, document names, templates, reports, and deferred features. Add regression tests for the confirmed user journey and failure cases.
  - Verify: Run `bun test --coverage`, `bun run lint`, and `bun run typecheck`. Manually run `extract --all`, `serve --document <name>`, and both `build` commands against local source files. Confirm no source or generated output is added to version control.
  - Files: `src/cli.ts`, `tests/integration/pipeline.test.ts`, `README.md`, `.gitignore`
  - Depends: Tasks 6, 9, and 10
  - Scope: Medium

### Checkpoint: Complete

- [x] Every Task 1 through Task 11 acceptance criterion is checked.
- [x] All tests, lint checks, and type checks pass.
- [x] The complete local pipeline works without network access.
- [x] The implementation plan and specification match the public CLI behavior.
- [x] The ticket is ready for human review.

## Parallelization Opportunities

- Tasks 4 and 5 can proceed in parallel after Tasks 2 and 3. Coordinate only through the shared model and report contracts.
- Task 7 can proceed in parallel with Tasks 4 through 6 after Task 2. The Markdown safety layer must not depend on either source adapter.
- Task 8 depends on Task 7 and can start before extraction tasks finish.
- Task 9 depends on Tasks 7 and 8. Task 10 depends on the same rendering contract and can be developed beside Task 9 after the interfaces are fixed.
- Do not parallelize changes to the root `package.json`, manifest schema, or common model. These files define shared contracts.
- Test fixture generation and adapter tests can run in parallel with renderer work after the model is stable.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PDF text order and image extraction vary by source | High | Start with small fixtures and the two local source files. Record confidence and page locations. Use a single-unit fallback and require human review. |
| EPUB packages contain unsupported XHTML or resource patterns | Medium | Test EPUB 2 and EPUB 3 fixtures. Preserve warnings and unresolved-resource records. Keep the adapter behind the common model. |
| No HTML-to-PDF adapter works cleanly with Bun on the target OS | High | Evaluate adapters before renderer implementation. Use an adapter interface and a local smoke test with the default template. |
| Source HTML or Markdown contains unsafe content | High | Sanitize all rendered fragments. Use an allowlist. Reject path traversal and remote resources in local-only mode. |
| Batch extraction overwrites manual corrections | High | Refuse an existing non-empty document by default. Require an explicit overwrite option. Show a clear warning before replacement. |
| Nested source names collide | Medium | Derive deterministic slugs, detect collisions before writing, and require an explicit document name or corrected source name. |
| PDF headers and footers pollute Markdown | Medium | Detect repeated regions conservatively. Record uncertain removals. Never silently discard text. |
| Bundled fonts create licensing or offline-use problems | Medium | Prefer system font stacks or clearly licensed local assets. Document fallback behavior. |
| Large books consume too much memory | Medium | Process source resources in bounded units, avoid copying archives unnecessarily, and add size limits only after measurement. |
| Tests accidentally use copyrighted source books | High | Generate small fixtures. Keep `sources/` ignored. Use local source files only for manual verification. |

## Resolved Decisions

- PDF parser: `pdf-parse` with per-page image extraction and page-screenshot fallback for unreadable embedded images.
- EPUB archive and XML: `fflate` plus `Bun.XML` and `htmlparser2`.
- Markdown rendering: `Bun.markdown` with `sanitize-html`.
- PDF output: local `pdfkit` adapter with the fixed editorial print layout.
- Overwrite option: `extract --force`.
- Batch unsupported files: reported through `skippedPaths`.

## Open Questions

- Which default font stack and Unicode font should replace the built-in Helvetica fallback for CJK and RTL PDF output?
- Which future translation ticket will define language metadata, directionality, and translation providers?
- Which later ticket will define EPUB export and its required metadata?

## Implementation Status

All Task 1 through Task 11 acceptance criteria are implemented and verified. The complete local workflow passes the test suite, type checks, lint checks, and manual `extract`, `serve`, and `build` runs. Browser verification found the rendered pages readable and navigable. Final approval is pending human review.
