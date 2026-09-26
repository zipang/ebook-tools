# Spec: T0001 — Local PDF and EPUB Extraction and Publishing Pipeline

**Ticket:** T0001  
**Title:** Local PDF and EPUB Extraction and Publishing Pipeline  
**Phase:** Implement  
**Status:** Implemented - awaiting final review

## Assumptions

1. A digital PDF contains selectable text. OCR is not part of this ticket.
2. An EPUB is an unencrypted EPUB 2 or EPUB 3 file with XHTML reading-order documents.
3. The library can contain many source documents. Each source maps to one independent document project.
4. The source file is read only. The tool does not modify or delete it.
5. Extraction favors semantic reading order over an exact copy of the source page layout.
6. The library is local only. Extraction, preview, HTML output, and PDF output do not require a network connection.
7. The first release prepares content for later translation. It does not translate text.
8. Generated output is disposable. Markdown files and document metadata are the source of truth.
9. The implementation may add focused dependencies after the project plan is approved.
10. Commander provides the CLI framework.

## Objective

Build a local Bun and TypeScript toolchain that turns books and documents into editable, Git-friendly projects. The tool extracts digital PDFs and EPUBs into semantic Markdown and local image assets. It serves the extracted content as rendered HTML and builds a readable PDF from the same content model.

The first release establishes a language-neutral content pipeline. A later release can translate the Markdown and render a language variant without changing the source structure.

### User Stories

- As a book owner, I want to extract an EPUB into ordered Markdown chapters so that I can edit the text without the original file container.
- As a document owner, I want to extract a digital PDF into readable Markdown and local images so that I can correct extraction errors.
- As an editor, I want to preview extracted chapters in a browser so that I can check content, images, and navigation before export.
- As a publisher, I want a configurable HTML and print template so that the PDF uses readable type, spacing, and hierarchy instead of the source page design.
- As a translator, I want plain-text, language-neutral content so that I can create a translated variant later.

## Scope

### In Scope

- One or more digital PDF or unencrypted EPUB files in a document library.
- Automatic input format detection from the file type and content.
- Semantic Markdown output with UTF-8 encoding.
- One Markdown file per EPUB reading-order document.
- PDF section or chapter splitting when structure is reliable.
- One continuous Markdown file when PDF structure is not reliable.
- Meaningful embedded image extraction from both source formats.
- Relative image links with stable local filenames.
- A human-readable extraction report and a machine-readable report.
- A local preview server implemented with `bun.serve()`.
- A document index, rendered chapter pages, local asset routes, and previous and next navigation.
- HTML rendering through document-owned templates and styles.
- PDF generation from the rendered HTML and print styles.
- A local-only default and no authentication.
- A TypeScript API boundary around extraction, project loading, rendering, and server behavior.

### Out of Scope

- OCR or scanned PDF support.
- DRM-protected or encrypted source files.
- Exact reproduction of source page geometry, headers, footers, or column layouts.
- A web administration interface or in-browser editor.
- Cloud hosting, remote access, accounts, or authentication.
- Automated translation or a translation provider integration.
- EPUB output generation in this ticket.
- Long-running batch job orchestration and a job queue.
- Live reload in the first preview server.
- A hosted document database.

## Functional Requirements

### Project Source of Truth

The repository is a multi-document library. Original source files stay in `sources/`. Extraction creates one independent project for each source under `documents/`:

```text
sources/
  first-book.epub
  second-document.pdf
documents/
  first-book/
    manifest.json
    chapters/
      001-<unit-title>.md
      002-<unit-title>.md
    assets/
      images/
    templates/
      base.html
      print.css
    reports/
      extraction.md
      extraction.json
    generated/
  second-document/
    manifest.json
    chapters/
      document.md
    assets/
      images/
    templates/
      base.html
      print.css
    reports/
      extraction.md
      extraction.json
    generated/
```

`manifest.json` is the index for one document. It records the document title, source metadata, language, unit identifiers, ordered unit paths, unit titles, and asset paths. It does not contain extracted body text. `generated/` contains disposable HTML and PDF output.

Each Markdown unit contains only semantic content. The manifest supplies metadata that the renderer needs. The format does not require YAML front matter. A unit can be edited with a normal text editor.

Markdown uses relative links such as `../assets/images/figure-001.png`. The renderer resolves these links inside the selected document boundary. The extractor never writes links to temporary extraction paths.

The extractor derives a safe document directory name from the source filename. An explicit document name can override the derived name. The extractor must detect name collisions and fail or report them before writing a project.

### Extraction

`extract` accepts either one source path or a batch request. It writes under the repository `documents/` directory. A single-document run can use an explicit document name. A batch run scans `sources/` and creates one project per supported file. It must:

1. Validate the input path or `sources/` directory and each supported format.
2. Keep every source file unchanged.
3. Parse each source into a common intermediate document model.
4. Detect headings, paragraphs, lists, links, tables, block quotes, code, footnotes, and meaningful images where the format supports them.
5. Normalize text to UTF-8 and remove repeated extraction artifacts.
6. Write ordered Markdown units and local image assets under `documents/<document-name>/`.
7. Write both extraction reports for each document.
8. Replace each output project atomically after a successful run.
9. In batch mode, process the remaining files after one file fails, report every failure, and return a non-zero exit code if any file failed.

The extractor removes repeated page headers, page footers, and navigation labels when it can identify them with confidence. It records uncertain removals in the report. It does not silently discard content.

#### EPUB Rules

- The package document and spine define reading order.
- Each spine document maps to one Markdown unit in order.
- Front matter and back matter remain separate units when they are part of the spine.
- Navigation documents, stylesheets, and scripts are not copied into the Markdown source unless they provide content.
- HTML elements map to semantic Markdown equivalents.
- Image URLs are resolved against the EPUB resource paths.
- Unresolved resources and unsupported structures produce warnings.
- DRM or malformed packages fail with an actionable error.

#### PDF Rules

- The extractor reads selectable text and embedded image resources.
- It uses headings and layout signals to propose semantic units.
- It creates multiple Markdown units only when the structure is reliable.
- It creates one continuous Markdown unit when structure is ambiguous.
- It records page ranges and confidence in `reports/extraction.json`.
- Pages with no extractable text and low-confidence content produce warnings.
- Complex multi-column or table-heavy pages produce warnings when the extractor cannot determine order.
- OCR is not attempted.

#### Image Rules

- Extract meaningful figures, illustrations, diagrams, and captioned images.
- Ignore repeated decorative assets when confidence is high.
- Preserve source formats when the output is safe and supported.
- Convert an unsupported image only when conversion is lossless enough for the intended output.
- Keep captions and nearby explanatory text in Markdown.
- Set meaningful alternative text when the source provides it.
- Record a stable asset identifier, source location, dimensions when available, and transformation status in the report.
- Ensure every image reference resolves to a file in the selected document project.

### Extraction Reports

`reports/extraction.md` gives a person a short review summary. It includes:

- Source type and file size.
- Number of Markdown units and images.
- Warnings grouped by source location.
- Pages or documents with uncertain reading order.
- Unresolved or converted assets.
- Counts of dropped, empty, or low-confidence regions.

`reports/extraction.json` contains the same information in a stable schema for future automation. It must not contain secrets or network credentials.

### Preview Server

The `serve` command starts a local server with `bun.serve()`. It requires a document directory name that exists under `documents/`. It does not accept an arbitrary filesystem path. The default host is `127.0.0.1`. The host and port are configurable for local development.

The server provides these routes for the selected document:

```text
GET /                         Document and unit index
GET /read/<unit-id>            Rendered Markdown unit
GET /assets/<path>             Local image or template asset
GET /health                    Server health response
```

The server must:

- Read the current Markdown and asset files for each request.
- Show the current edited content without a separate publish step.
- Render headings, paragraphs, lists, tables, block quotes, code, links, and images as safe HTML.
- Provide previous and next links based on manifest order.
- Provide a link to the document index.
- Reject path traversal and requests outside the selected document directory.
- Return useful `404` and `400` responses.
- Avoid network requests while serving local content.

The first release does not include live reload. Refreshing the browser displays edited files.

### Rendering and PDF Export

The `build` command selects one document under `documents/`, reads its manifest, and renders units in order. It uses safe HTML templates and print styles. The default theme must provide:

- A semantic heading hierarchy.
- A readable body size and line height.
- A controlled maximum line length.
- Clear paragraph and list spacing.
- Responsive image scaling.
- Accessible color contrast.
- Keyboard-usable navigation.
- Print page margins and sensible page breaks.
- Styles for code, tables, captions, and block quotes.

Document templates can override the default values. A template change must not require changing the Markdown content.

`build --format html` writes navigable HTML output. `build --format pdf` writes a valid PDF. Both formats use the same semantic content model and print-oriented styles. The PDF adapter runs locally and does not send content to a service.

The generated output includes a table of contents when the document has more than one unit. The output directory can be deleted and regenerated without data loss.

## Commands

The implementation will expose these package scripts:

```bash
# Install dependencies
bun install

# Extract one source from sources/ into documents/<document-name>/
bun run extract -- --input <input-file> [--document <document-name>]

# Extract every supported source in sources/
bun run extract -- --all

# Start the local preview server for one document
bun run serve -- --document <document-name> --port 3000

# Render navigable HTML for one document
bun run build -- --document <document-name> --format html --out <output-dir>

# Render a PDF for one document
bun run build -- --document <document-name> --format pdf --out <output-dir>

# Run tests
bun test --coverage

# Run static checks
bun run lint
bun run typecheck
```

The CLI uses Commander. It prints actionable errors and returns a non-zero exit code for invalid input, unsupported formats, malformed packages, and output failures. Warnings do not make an otherwise successful run fail.

## Tech Stack

- **Runtime:** Bun.
- **Language:** TypeScript in strict mode.
- **CLI:** Commander.
- **Source formats:** Digital PDF and unencrypted EPUB 2 or EPUB 3.
- **Document model:** Framework-independent TypeScript types.
- **Markdown:** A maintained Markdown parser and serializer selected during implementation.
- **HTML safety:** A maintained HTML sanitizer selected during implementation.
- **Templates:** Local HTML and CSS files with theme variables.
- **PDF output:** Local PDFKit adapter with a fixed editorial print layout. `Bun.WebView` print is unavailable without a local Chrome installation.
- **Tests:** Bun test.
- **Static checks:** A TypeScript-aware linter and type checker configured in `package.json`.

The implementation plan must evaluate parser, sanitizer, archive, and PDF dependencies before installation. The project must work without a remote API.

## Project Structure

The source repository will use this structure:

```text
sources/                         Original PDF and EPUB files
documents/                       Extracted document projects
src/
  cli.ts                         Commander entry point
  commands/
    extract.ts                   Extraction command
    serve.ts                     Preview server command
    build.ts                     HTML and PDF build command
  extract/
    common.ts                    Shared extraction interfaces
    pdf.ts                       PDF adapter
    epub.ts                      EPUB adapter
  model/
    document.ts                  Common document model
    project.ts                   Project manifest model
  markdown/
    parse.ts                     Markdown to safe HTML
    serialize.ts                 Intermediate model to Markdown
  render/
    template.ts                  Template loading
    html.ts                      HTML document generation
    pdf.ts                       PDF export adapter
  server/
    server.ts                    bun.serve() setup
    routes.ts                    Local route handlers
  templates/
    default/                     Built-in fallback templates
  shared/
    errors.ts                    Typed application errors
    paths.ts                     Safe path handling
    result.ts                    Shared result types
tests/
  unit/                          Parser, model, and utility tests
  integration/                   Command and project tests
  fixtures/
    pdf/                         Small generated PDF fixtures
    epub/                        Small generated EPUB fixtures
    projects/                    Expected project fixtures
```

The library can contain generated document projects, but source books and generated output are ignored by version control by default. Tests may use small fixtures that contain no copyrighted books.

## Code Style

Use strict TypeScript. Use `camelCase` for variables and functions. Use `kebab-case` for file names. Use explicit return types for public functions. Model states with discriminated unions instead of ambiguous optional fields. Avoid `any`. Keep extraction, serialization, and rendering transformations pure where possible. Use typed errors and stable machine-readable report codes.

Use dependency injection for source parsers, renderers, and file-system access in unit tests. Keep adapters small. Put shared document rules in the model layer. Do not couple EPUB or PDF details to the Markdown serializer.

Example:

```ts
export type ExtractResult = {
  projectDir: string;
  unitCount: number;
  imageCount: number;
  warningCount: number;
};

export async function extractProject(
  inputPath: string,
  outputDir: string,
): Promise<ExtractResult> {
  const source = await loadSource(inputPath);
  const project = await convertSource(source);
  return writeProject(project, outputDir);
}
```

The example shows naming, explicit types, staged conversion, and a typed result. It does not prescribe a parser implementation.

## Testing Strategy

### Unit Tests

Test these units in isolation:

- EPUB package and spine reading order.
- PDF text and image extraction adapters.
- Heading and unit-boundary detection.
- Markdown serialization and image URL rewriting.
- Markdown parsing and safe HTML output.
- Manifest loading and validation.
- Path safety and document directory enforcement.
- Report generation and stable warning codes.
- Template selection and theme defaults.

### Integration Tests

Use small fixtures to test these complete paths:

- Extract an EPUB with multiple chapters, headings, lists, links, and images.
- Extract a digital PDF with text, one image, and a detectable section boundary.
- Extract a PDF with ambiguous structure and verify the single-unit fallback.
- Extract two source files in batch mode and verify separate document directories.
- Run `serve --document <name>` and verify the index, a rendered unit, assets, navigation, and path rejection.
- Run `serve` with an unknown or unsafe document name and verify rejection.
- Edit a Markdown file and verify that the next `serve` request shows the edit.
- Build HTML for one document and verify navigation, semantic elements, styles, and local image URLs.
- Build PDF for one document and verify that a valid PDF is created with readable text and image content.
- Reject encrypted, scanned-only, malformed, and unsupported inputs with actionable errors.

### Test Locations and Commands

- Put unit tests in `tests/unit/`.
- Put command and pipeline tests in `tests/integration/`.
- Put small generated fixtures in `tests/fixtures/`.
- Run `bun test --coverage` before completion.
- Require coverage for core model, path, report, and command boundary modules.
- Do not require a fixed coverage percentage for adapter code until the parser choice is known.

### Manual Verification

- Open the local preview URL for the selected document in a browser.
- Navigate between all generated units.
- Select a second document and verify that its content and assets remain separate.
- Resize the browser and inspect image scaling and text wrapping.
- Print the HTML preview to PDF and inspect margins, page breaks, and contrast.
- Confirm that every original source file has not changed.

## Boundaries

### Always

- Validate every input path and document directory name.
- Keep source documents unchanged.
- Keep source documents and generated output outside version control by default.
- Run tests, lint, and type checks before completion.
- Report uncertain extraction results instead of hiding them.
- Sanitize source HTML before rendering.
- Keep server requests inside the selected document directory.
- Use relative asset paths in document Markdown.
- Regenerate disposable output from the source of truth.

### Ask First

- Add a new parser, sanitizer, archive, or PDF dependency.
- Change the `manifest.json` schema or document folder contract.
- Change the public CLI command names or flags.
- Add network access, remote services, or an external translation provider.
- Add OCR, EPUB generation, long-running batch orchestration, or a browser editor.
- Add a new output format or a second content model.

### Never

- Commit source books, copyrighted fixtures, API keys, or credentials.
- Modify or delete the original PDF or EPUB.
- Silently drop text, images, warnings, or failed resources.
- Render unsafe source HTML without sanitization.
- Expose the preview server publicly by default.
- Treat generated output as the source of truth.
- Remove or weaken a failing test to make a build pass.

## Success Criteria

The ticket is complete when all of the following are true:

1. A supported EPUB extracts into ordered Markdown units and local image files.
2. A supported digital PDF extracts into semantic Markdown, with reliable section splitting or the documented single-unit fallback.
3. Per-file and batch extraction create separate `documents/<document-name>/` projects without mixing content.
4. Every extracted image link resolves inside its document folder.
5. The extraction report identifies warnings and uncertain source regions.
6. `serve --document <name>` starts with `bun.serve()` and serves the selected document index, rendered units, local assets, health response, and ordered navigation.
7. Editing a Markdown file changes the next server response without a publish step.
8. `build --document <name> --format html` creates navigable semantic HTML with the configured readable theme.
9. `build --document <name> --format pdf` creates a valid local PDF with readable typography, spacing, headings, and images.
10. The full pipeline works without network access.
11. Invalid, encrypted, scanned-only, and malformed inputs fail with actionable non-zero CLI results.
12. `bun test --coverage`, `bun run lint`, and `bun run typecheck` pass.
13. The project structure and CLI contract are documented through this spec and the implementation plan.

## Open Questions

These choices do not change the public behavior in this specification.

- Which maintained PDF parser gives the best text order and image extraction for the first target corpus?
- Which local HTML-to-PDF adapter is acceptable for Bun on the target operating systems?
- Which default fonts can be bundled or installed without violating licensing and offline-use constraints?
- How aggressive should PDF header and footer detection be for the first release?
- Which translation provider and directionality rules will the later translation ticket use?
- Which EPUB export requirements will define the later EPUB-generation ticket?
