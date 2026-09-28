# Spec: T0003 — Refactoring needed for a Web UI

**Ticket:** T0003
**Title:** Refactoring needed for a Web UI
**Phase:** Specify
**Status:** Draft — awaiting human review
**Depends on:** T0001 (extraction and publishing pipeline), T0002 (parallel model-assisted document translation)
**Origin:** Code review of `src/` (35 files, 26 findings). Gates at review time: `bun run typecheck` pass, `bun run lint` pass, `bun test` 162 pass / 0 fail.

## Assumptions

1. This ticket is prerequisite refactoring only. It stops when the code is Web-UI-ready. It writes no Web UI code.
2. A Web UI is the next project. This ticket makes it *addable*, and it names no framework, no route list, and no component.
3. The 26 review findings are the requirement set. They are recorded below without rephrasing. Their severity, their line references, and their file:line anchors are the reviewer's output and are reproduced as-is.
4. The work lands as four reviewable pull requests. Each pull request is independently reviewable and independently revertable.
5. The two correctness defects ship inside this ticket, in the first pull request, so they do not wait behind the refactor.
6. `src/model/` and `src/shared/` keep their current behavior. This ticket moves code between layers and removes duplication. It does not change what the pipeline produces.
7. No runtime dependency is added. `package.json` `dependencies` is unchanged by this ticket.
8. Tests are colocated with the code they test. A test for `src/services/document.ts` is `src/services/document.test.ts`. No new file is added under `tests/`.
9. Only unit tests are written in this ticket, and only for the core services. Integration and end-to-end tests are out of scope for now.
10. The seven files under `tests/integration/` are deleted. They hold 43 tests. The remaining suite is 119 unit tests, and that is the baseline this ticket starts from.
11. Deleting `tests/integration/` removes the only existing coverage of finding 1. Both bug fixes therefore need a colocated unit test written in pull request 1, before the fix lands.
12. The files under `tests/fixtures/` stay. `tests/unit/epub.test.ts` and `tests/unit/pdf.test.ts` still use them.
13. The 17 files under `tests/unit/` are not migrated by this ticket. They keep their location and their `../../src/` imports.
14. A `DocumentManifest` remains the only contract between a service and an adapter. No new serialization format is introduced.
15. The reviewer's claim that the domain layer is already clean is accepted. `src/model/` is pure data and pure validation with no I/O. That is the foundation this ticket builds on.

## Objective

Remove the four structural obstacles that currently force a Web UI to import from the HTTP layer or to guess at hidden inputs, and fix the two correctness defects found alongside them. When this ticket is done, a Web UI adapter can be added by calling existing service functions, with no change to `src/model/`, `src/shared/`, `src/extract/`, or `src/translate/`.

### Why this is needed

`src/commands/build.ts:5` imports `loadDocumentContext` from `../server/routes.ts`. The document-loading rule lives inside a route module. A Web UI cannot read a document without importing an HTTP route file, and that module pulls `Bun.serve` into the graph transitively.

Three more obstacles sit behind it:

- `process.cwd()` as a default parameter hides the one value a Web UI and a test must control (`src/commands/serve.ts:6`, `src/commands/extract.ts:7`).
- Services write to the terminal (`src/commands/serve.ts:14`, `src/render/pdf.ts:84`), so a Web UI loses the diagnostic and gains nothing.
- A module-level cache of a filesystem read (`src/render/template.ts:44`) makes the result of `loadTemplateSet()` depend on call order.

Alongside those, two defects cost money or time today:

- The `--report` flag is silently ignored (`src/commands/translate.ts:130`).
- A failing translate run discards the cache for every unit it did translate (`src/translate/translate.ts:533`).

### What is already right and must not regress

The review found the domain layer genuinely clean. This ticket builds on that and must not erode it.

| Existing strength | Location | Constraint for this ticket |
|---|---|---|
| Domain is pure, no I/O | `src/model/document.ts`, `src/model/project.ts:179` | No file access is added under `src/model/` |
| `src/shared/` has no internal dependencies | `src/shared/*` | New shared helpers depend on nothing internal |
| Translate already has the right port shape | `src/commands/translate.ts:83`, `src/translate/translate.ts:341` | The pattern is extended, not replaced |
| Every manifest read is validated | `validateManifest` | No path reads a manifest without validating it |
| Errors carry stable codes | `src/shared/errors.ts:1-11` | No caller matches on message text |
| Security posture is strong | `src/server/routes.ts:23-28,44-50,72,135-138`, `src/shared/sanitize.ts:75-113` | CSP, path containment, symlink rejection, and the sanitizer keep their behavior |

## Scope

### In Scope

- All 26 findings from the `src/` code review, recorded in the Requirements section without rephrasing.
- The four pull requests that carry them, defined in the Delivery section.
- A new `src/services/` layer that owns document loading, shared by the CLI and the HTTP adapter.
- Removal of the duplicated helpers named in findings 8, 9, 10, and 11.
- The JSDoc blocks required by root `AGENTS.md` on the 24 functions listed in finding 12.
- A `src/AGENTS.md` that states the layer rules this ticket establishes, so the rules survive the next contributor.
- Colocated unit tests for the core services, named `*.test.ts` beside their source.
- Deletion of the seven files under `tests/integration/`, which hold 43 tests.

### Out of Scope

- Any Web UI code, framework, component, route, or bundle.
- Any new command. `extract`, `serve`, `build`, `delete`, and `translate` keep their current flags and their current output.
- Any change to what a document project contains on disk. The manifest schema stays at version 1.
- EPUB export, OCR, or any extraction capability.
- Any change to the model registry, the prompt, or the translation contract.
- New runtime dependencies.
- Performance work beyond finding 15 (the O(n²) lookups in the translate path).
- Rewriting `src/extract/epub.ts`. Finding 12 adds JSDoc to it. It does not restructure it.
- Migrating the 17 files under `tests/unit/` to colocated placement. They keep their current location.
- Integration, end-to-end, and snapshot tests. The ticket writes unit tests only.
- Deleting or moving `tests/fixtures/`. Two remaining unit tests depend on it.

## Requirements

The 26 findings follow, in the reviewer's order and wording. Severity, location, and fix are reproduced from the review.

### PR 1 — Correctness defects

| # | Location | Axis | Severity | Problem | Fix |
|---|---|---|---|---|---|
| 1 | `commands/translate.ts:130` | Correctness | **Critical** | `--report` never reaches `translateDocument` | Add `reportPath: options.report` |
| 2 | `translate/translate.ts:533` | Correctness | **Major** | Early return skips `writeCache`; paid work is re-billed | Write the cache before the return, or in `finally` |

Finding 1 is confirmed at runtime. Passing `report: "reports/custom.md"` produces `reports/translation.md` and `reports/translation.json`, and no `custom.md`. The only test that covers this option is `tests/integration/translate-command.test.ts:125-133`, and it asserts just `result.translated === 2`, which is why the suite stayed green over the defect. That file is deleted by this ticket, so `src/commands/translate.test.ts` must carry the coverage instead.

Finding 2 is confirmed at runtime. After a successful run the cache file exists. After a failing run it is absent, so every unit that translated cleanly in a partially-failed run is billed again on retry. This contradicts `README.md:93`.

### PR 2 — The service layer (the Web UI unblock)

| # | Location | Axis | Severity | Problem | Fix |
|---|---|---|---|---|---|
| 3 | `commands/build.ts:5` | Architecture | **Major** | Service imports `server/routes.ts` | Move `loadDocumentContext` to `src/services/document.ts` |
| 5 | `commands/serve.ts:6`, `commands/extract.ts:7` | Architecture | **Major** | `process.cwd()` default hides the input a Web UI must set | Make `repositoryRoot` required |
| 6 | `commands/serve.ts:14`, `render/pdf.ts:84` | Architecture | **Major** | Services write to the terminal | Return the info; let the adapter log |
| 7 | `render/template.ts:44` | Architecture | **Major** | Module-level cache makes the result order-dependent | Let the caller own the cache |
| 9 | `server/routes.ts:31`, `commands/delete.ts:54` | Simplification | **Major** | `readManifest` duplicated verbatim; a 3rd variant at `translate/translate.ts:129-141` | One loader in `src/services/document.ts` |
| 4 | `commands/delete.ts:113-124` | Correctness | **Major** | Delete-then-write is not atomic | Reuse the temp-dir+rename pattern from `extract/writer.ts:129-149` |

Findings 3 and 9 land together. One file move fixes both. `loadDocumentContext` and its private `readManifest` move into a new `src/services/document.ts`. `server/routes.ts:71` and `commands/build.ts:135` both import the service. `translate/translate.ts:129-141` and `commands/delete.ts:54` then use the same loader.

Finding 4 sits in this pull request because `deleteDocumentParts` becomes a service and must not carry a data-loss path into the new layer. The pattern already exists at `extract/writer.ts:129-149`: write to a temporary directory, rename, keep a backup, restore on failure.

### PR 3 — The duplication pass

| # | Location | Axis | Severity | Problem | Fix |
|---|---|---|---|---|---|
| 8 | `render/html.ts:18`, `render/template.ts:29`, `commands/build.ts:88` | Simplification + Security | **Major** | `escapeHtml` defined 3× — divergent escaping is a security bug, not a style nit | One function in `src/shared/` |
| 10 | `commands/delete.ts:27,32` vs `model/project.ts:138` vs `extract/pdf.ts:161,177,196` vs `extract/epub.ts:645,653` | Simplification | **Major** | Unit-id and unit-path conventions live in 6 places. Change one and `delete` silently corrupts manifests | One `nextUnitId(index)` + `nextUnitPath(index, title)` in `model/project.ts` |
| 11 | `extract/epub.ts:123-153`, `extract/pdf.ts:72-96`, `render/pdf.ts:71-77` | Simplification | **Major** | Image magic-byte sniffing 3× | One `detectImageFormat(bytes)` in `src/shared/` |
| 15 | `translate/translate.ts:495-513, 282-290, 524` | Performance | Minor | `Array.find` inside a loop over all units — O(n²) | Use the `Map` already built at line 515 |
| 19 | `commands/build.ts:82` | Simplification | Minor | `templates?.styles ?? ""` — the optional chain is dead; every caller passes a loaded `TemplateSet` | `templates.styles` |
| 22 | `translate/translate.ts:551-554` | Simplification | Nit | `ordered[0]?.` repeated three times in one expression | Bind `const first = ordered[0]` |
| 23 | `commands/translate.ts:111` | Simplification | Nit | Hardcodes `4`; `translate/translate.ts:30` already defines `DEFAULT_CONCURRENCY = 4`. Two sources of truth | Import the constant |
| 25 | `commands/extract.ts:5-7`, `commands/serve.ts:4-6` | Consistency | Nit | Inline option object types, unlike `BuildDocumentOptions`, `DeleteDocumentOptions`, `TranslateCommandOptions` | Export named types |
| 24 | `commands/translate.ts:65` | Naming | Nit | `parseUnits` validates and de-duplicates a *selection* | `parseSelectedUnits` |

Finding 8 is security-relevant, not cosmetic. Three copies of `escapeHtml` means the PDF table-of-contents escaping is not guaranteed to match the render escaping. It collapses to one function.

Finding 10 is the highest-risk item in this pull request. The unit-id and unit-path conventions are written out in six places. `commands/delete.ts:27,32` and `model/project.ts:138` must end up calling the same two functions, or a format change silently corrupts a manifest.

### PR 4 — Rules, types, and robustness

| # | Location | Axis | Severity | Problem | Fix |
|---|---|---|---|---|---|
| 12 | `extract/epub.ts` 16 sites, `translate/validate.ts:30,40,145`, `translate/translate.ts:36`, `markdown/from-html-bridge.ts:6,12,13,14` | Rules | **Major** | 24 functions with no JSDoc; root `AGENTS.md` says "IMPORTANT: Declare a proper JSDoc block for every function" | Add the blocks |
| 13 | `commands/translate.ts:152-162` | Types + Correctness | **Major** | `countUnits` skips validation, uses string concat, returns `Infinity` when the manifest is missing so any `--only` passes | Delete it; use `loadSourceProject(...).manifest.units.length` |
| 14 | `commands/build.ts:53-54,101-102` | Types | **Major** | Manifest typed as `Parameters<typeof renderIndexPage>[0]` | Import `DocumentManifest` |
| 16 | `shared/paths.ts:47-62` | Robustness | Minor | `assertNotSymlink` re-throws by matching `error.message.startsWith("Symbolic links")`; a real `ENOENT`/permission error is flattened to "Unable to inspect path" with the cause dropped | Use a typed error or a flag |
| 17 | `translate/translate.ts:403,466` | Correctness | Minor | The `--max-cost` check runs before the call, and only successful units add to `spent`. Truncated/failed units cost real money (`:440`, `:460`) and are never counted | Count cost on every billed outcome; document the concurrency overshoot |
| 18 | `model/project.ts:225-232` | Correctness | Minor | Unique ids enforced for units, never for assets. `extract/writer.ts:77-79` keys `assetPaths` by asset id, so duplicate ids silently collapse | Assert unique asset ids |
| 20 | `commands/translate.ts:192` | Simplification | Minor | `options.maxCost === undefined ? undefined : Number(...)` is the only option not passed through; `parseNumber` already accepts `number \| string`, so that branch is dead | Pass the value, let `parseNumber` coerce |
| 21 | `tsconfig.json:12` (`exactOptionalPropertyTypes`) | Simplification | Minor | Forces 8+ conditional-spread workarounds: `commands/serve.ts:11-12`, `extract/batch.ts:69,140` | Declare `force?: boolean \| undefined` in option types, the idiom already used at `commands/translate.ts:12-26` |
| 26 | `translate/translate.ts:104` | Rules | Nit | `(error as { statusCode?: number } \| null)?.statusCode` — a cast at an external-SDK boundary, which is legitimate, but root `AGENTS.md` asks non-obvious control flow to be explained and there is no comment | One comment line |

## The Layer Contract

This section is the definition of done for the Web UI. It states what a future adapter gets.

| Layer | Location | Role | May import |
|---|---|---|---|
| Adapters | `src/cli.ts`, `src/commands/`, `src/server/`, `src/render/` | Parse input, call services, format output | `src/services/`, `src/translate/`, `src/extract/`, `src/model/`, `src/shared/` |
| Services | `src/services/` (new), `src/extract/`, `src/translate/` | Business logic, orchestration, validation | `src/model/`, `src/shared/` |
| Domain | `src/model/` | Data shapes, invariants, pure functions | `src/shared/` only |
| Shared | `src/shared/` | Errors, paths, sanitizing, reporting, escaping, image sniffing | nothing internal |

A service never imports a file from `src/server/`, `src/render/`, or `src/commands/`. An adapter may import a service.

A service function takes plain values and returns a plain result object. It never reads the clock, the network, the terminal, or the current directory for itself. Forbidden inside a service: `process.cwd()` as a default, `console.*`, `process.exit`, and reads of `process.env` that are not passed in.

The test for the whole ticket: write a throwaway Web UI adapter — parse input, call `loadDocumentContext` / `buildDocument` / `deleteDocumentParts` / `translateDocument`, format output. It must compile with no change to `src/model/`, `src/shared/`, `src/extract/`, or `src/translate/`. The adapter is deleted after the check. It is a proof, not a deliverable.

## Commands

Unchanged by this ticket. Each pull request must leave these green. `bun test` discovers colocated tests, so no command changes when a test moves from `tests/` to `src/`.

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # biome check .
bun test             # bun test. 119 pass / 0 fail at ticket start, after the 43 integration tests are deleted
bun test src/        # run only the colocated tests
bunx biome check --write <files>   # reformat the files you edited
```

Biome lints test files like any other source file, so a colocated test must meet the same JSDoc, arrow-function, and tab rules as the code it tests.

## Project Structure

New in this ticket:

```text
src/services/document.ts         Document loading, shared by the CLI and the HTTP adapter
src/services/document.test.ts    Unit test for the loader, with no server attached
src/AGENTS.md                    The layer rules above, stated for the next contributor
```

Changed in this ticket:

```text
src/commands/build.ts            No longer imports src/server/routes.ts
src/commands/build.test.ts       Unit tests for buildDocument
src/commands/serve.ts            No process.cwd() default, no console.log
src/commands/extract.ts          No process.cwd() default
src/commands/extract.test.ts     Unit tests for runExtract against a temp repository root
src/commands/delete.ts           Atomic, uses the shared loader and the shared id helpers
src/commands/delete.test.ts      Unit tests for deleteDocumentParts
src/commands/translate.ts        No countUnits, imports DEFAULT_CONCURRENCY
src/commands/translate.test.ts   Unit tests for runTranslate, including findings 1, 2, and 13
src/server/routes.ts             Uses the service loader, no private readManifest
src/render/template.ts           No module-level cache
src/render/pdf.ts                Returns skipped-image info, no console.warn
src/render/html.ts               Uses the shared escapeHtml
src/model/project.ts             Owns nextUnitId and nextUnitPath
src/model/project.test.ts        Unit tests for the id helpers and the asset-id uniqueness rule
src/translate/translate.ts       Writes the cache on a failed run, uses the shared loader
src/translate/translate.test.ts  Unit tests for the orchestration, with an injected ModelRunner
src/shared/                      Gains escapeHtml and detectImageFormat
src/shared/escape.test.ts        Unit test for the shared escapeHtml
src/shared/image.test.ts         Unit test for detectImageFormat
```

Deleted in this ticket:

```text
tests/integration/build.test.ts
tests/integration/delete.test.ts
tests/integration/extract.test.ts
tests/integration/pipeline.test.ts
tests/integration/serve.test.ts
tests/integration/translate-command.test.ts
tests/integration/translate.test.ts
```

Unchanged: `src/extract/`, `src/markdown/`, `src/translate/validate.ts`, `src/translate/types.ts`, `src/translate/providers/`, `package.json`, `tests/unit/`, `tests/fixtures/`.

## Code Style

One real example, showing the layer boundary this ticket establishes. A service returns data. The adapter prints it.

```ts
/** Start the local preview server for one extracted document. */
export const runServe = async (
  options: ServeOptions,
  repositoryRoot: string
): Promise<DocumentServer> => {
  const server = await startDocumentServer({
    repositoryRoot,
    documentName: options.document,
    ...(options.host === undefined ? {} : { host: options.host })
  });

  return server;
};
```

The adapter in `src/commands/serve.ts` keeps the `console.log`, because an adapter owns output. Note `repositoryRoot` is a required parameter with no default.

Conventions that apply to every change in this ticket, from root `AGENTS.md`:

- Declare a full JSDoc block for every function. This is the requirement finding 12 enforces.
- Prefer `const fn = () => {}`. Do not use the `function` keyword.
- Leave a blank line before `if`, loops, and `return`.
- Use tabs for every file except Markdown, which uses 2 spaces.
- Use Bun, not Node.js. `Bun.file` over `readFile`.
- Reformat the edited files with Biome before committing.

## Testing Strategy

**Framework:** `bun test`.

**Location:** a test file sits beside the file it tests and carries the same base name. `src/services/document.ts` is tested by `src/services/document.test.ts`. No new test file is created under `tests/`.

**Scope:** unit tests for the core services only. The core services are the functions a Web UI adapter will call:

| Service | Source | Colocated test |
|---|---|---|
| Document loading | `src/services/document.ts` | `src/services/document.test.ts` |
| Extract | `src/commands/extract.ts` | `src/commands/extract.test.ts` |
| Build | `src/commands/build.ts` | `src/commands/build.test.ts` |
| Delete units | `src/commands/delete.ts` | `src/commands/delete.test.ts` |
| Translate | `src/commands/translate.ts` | `src/commands/translate.test.ts` |
| Translate orchestration | `src/translate/translate.ts` | `src/translate/translate.test.ts` |
| Manifest and unit ids | `src/model/project.ts` | `src/model/project.test.ts` |
| Shared helpers | `src/shared/escape.ts`, `src/shared/image.ts` | beside each |

A unit test here means: construct the inputs, call the function, assert the returned value. Where a function must touch the filesystem, the test points it at a directory it creates under the system temp directory and passes the path in. Where a function calls a model, the test injects the existing `ModelRunner` seam. No test starts a server, and no test drives the CLI.

**Baseline:** the seven files under `tests/integration/` are deleted, removing 43 tests. The suite therefore starts this ticket at **119 passing** and must finish at **119 or more**. The 17 files under `tests/unit/` are not touched, and none of their 119 tests may be deleted or weakened.

**The one test this ticket must not lose:** `tests/integration/translate-command.test.ts:125-133` is the only existing test that exercises `--report`, and it asserts nothing about the report file. Deleting it removes the last trace of finding 1. `src/commands/translate.test.ts` must therefore cover finding 1 before the fix lands, or the defect ships with no test at all.

New tests required by this ticket:

| Finding | Colocated test | Assertion |
|---|---|---|
| 1 | `src/commands/translate.test.ts` | With `report: "reports/custom.md"`, the file `custom.md` exists under the output project. This is the coverage the deleted integration test failed to provide. |
| 2 | `src/commands/translate.test.ts` | A run where one unit fails leaves `translation.cache.json` on disk, with an entry for each unit that succeeded. |
| 3 | `src/services/document.test.ts` | The loader resolves a document by path. The module imports no adapter, and the test asserts that without a running server. |
| 4 | `src/commands/delete.test.ts` | A delete that fails after the write phase leaves the original unit files readable. |
| 5 | every service test | Each service is called with an explicit `repositoryRoot`. No test relies on a `process.cwd()` default. |
| 6 | `src/render/pdf.test.ts` | A skipped image is returned as data. The function does not write to the terminal. |
| 8 | `src/shared/escape.test.ts` | One test over `&`, `<`, `>`, `"`, and `'`. |
| 10 | `src/model/project.test.ts` | `nextUnitId` and `nextUnitPath` match the current format exactly, so the format is pinned before it is centralized. |
| 11 | `src/shared/image.test.ts` | `detectImageFormat` over PNG, JPEG, GIF, WebP, and one unknown signature. |
| 12 | none | Covered by review, not by a test. |
| 13 | `src/commands/translate.test.ts` | `--only 999` against a 2-unit document is rejected. This is the case the `Infinity` return silently permits today. |
| 17 | `src/commands/translate.test.ts` | A run whose units are truncated reports the cost of the truncated units. |

**Test levels.** Unit only, for the core services, in this ticket. The Web UI proof is a compile check, not a test. Integration and end-to-end coverage is a later ticket, once the service signatures have settled.

## Boundaries

### Always

- Run `bun run typecheck`, `bun run lint`, and `bun test` before every commit.
- Keep the 119 tests in `tests/unit/` passing. None of them may be deleted, skipped, or weakened.
- Put every new test beside its source, named `<module>.test.ts`. Never add a file under `tests/`.
- Write the failing test before the fix for finding 1 and finding 2. The test is what proves the defect.
- Reformat the edited files with `bunx biome check --write`.
- Keep one pull request to one concern. Four pull requests, four concerns.
- Cite the finding number in the commit message and in the pull request body.
- Update `src/AGENTS.md` in pull request 2, where the layer rules first take effect. It records the colocated-test rule.

### Ask First

- Any change to the manifest schema version. This ticket keeps it at version 1.
- Any new runtime dependency in `package.json`.
- Any change to a command-line flag, its default, or its output text.
- Any change to the sanitizer allow-list, the CSP, or the path containment logic.
- Reordering or regrouping the findings inside a pull request.
- Splitting a pull request further, or merging two of them.

### Never

- Write Web UI code in this ticket.
- Add a framework, a bundler, or a client library.
- Delete or weaken a test to make a change land.
- Delete, skip, or weaken any of the 119 tests in `tests/unit/`.
- Add a new test file under `tests/`. New tests are colocated in `src/`.
- Write an integration or end-to-end test in this ticket.
- Weaken a security control to make a refactor simpler. The CSP, the path containment, the symlink rejection, and the sanitizer keep their behavior.
- Match on an error message string in new code. Finding 16 removes one instance. Do not add another.
- Let a service import an adapter, or keep `process.cwd()` as a default parameter.
- Change what a document project contains on disk.

## Success Criteria

Each criterion is specific and testable.

1. `--report reports/custom.md` writes `custom.md` under the output project. A colocated test asserts the file exists.
2. A translate run with at least one failure leaves `translation.cache.json` on disk, holding an entry for every unit that translated successfully.
3. No file under `src/services/`, `src/extract/`, or `src/translate/` imports from `src/server/`, `src/render/`, or `src/commands/`. Verified by grep, and enforced in the review.
4. No `process.cwd()` remains as a default parameter value in `src/`.
5. No `console.*` and no `process.exit` remains in `src/services/`, `src/extract/`, `src/translate/`, or `src/render/`.
6. No module-level mutable cache remains in `src/render/template.ts`.
7. `escapeHtml` is defined exactly once in `src/`.
8. The unit-id and unit-path conventions are produced by exactly one function each, in `src/model/project.ts`.
9. Image magic-byte sniffing exists in exactly one place in `src/`.
10. All 24 functions in finding 12 have a JSDoc block.
11. `--only 999` against a 2-unit document is rejected with a validation error.
12. A throwaway Web UI adapter compiles and runs against the services, with no change to `src/model/`, `src/shared/`, `src/extract/`, or `src/translate/`.
13. `bun run typecheck` passes, `bun run lint` passes, `bun test` reports 119 passing or more with 0 failures.
14. Every new test file is named `<module>.test.ts` and sits beside the module it tests. `bun test` discovers them, so no command changes.
15. `tests/integration/` no longer exists, and `git status` shows its seven files as deleted.
16. The 17 files under `tests/unit/` are unchanged, and their 119 tests still pass.
17. `package.json` `dependencies` is unchanged.
18. The work arrived in four pull requests, each reviewable on its own.
19. `src/AGENTS.md` exists and states the layer table from this spec, and records the colocated-test rule.

## Open Questions

None blocking. Three items are noted so they are not lost:

1. **Finding 21** (`exactOptionalPropertyTypes`) can be resolved either by changing the option types to `force?: boolean | undefined`, as the reviewer's fix says, or by relaxing the `tsconfig.json` flag. The reviewer's fix is the recommendation, because `src/commands/translate.ts:12-26` and `src/translate/types.ts:105-117` already use that idiom. Relaxing the flag is an "ask first" item.
2. **Finding 17** (the `--max-cost` ceiling) has a concurrency overshoot that cannot be removed without serializing the pool. The fix counts the cost of every billed outcome and documents the overshoot. Changing the pool to strict budgeting is out of scope.
3. **Coverage lost with `tests/integration/`.** The 43 deleted tests were the only end-to-end cover for `extract`, `serve`, `build`, `delete`, and the full `translate` command. A colocated unit test proves each service in isolation, but nothing in this ticket proves that the five commands still work together. A follow-up ticket should add integration coverage back once the service signatures have settled. The pipeline currently has no end-to-end safety net, and that is a deliberate, accepted gap for the duration of this ticket.
