# Implementation Plan: T0003 — Refactoring needed for a Web UI

**Ticket:** T0003
**Title:** Refactoring needed for a Web UI
**Phase:** Plan
**Status:** Planned — awaiting human review
**Specification:** `roadmap/T0003/spec.md`
**Depends on:** T0001 (implemented), T0002 (implemented)
**Origin:** Code review of `src/`, 35 files, 26 findings

## Overview

Make `src/` Web-UI-ready. The work removes the four structural obstacles that force a future Web UI to import from the HTTP layer or to guess at hidden inputs, removes the duplicated helpers the review found, brings the code up to the root `AGENTS.md` JSDoc rule, and fixes the two correctness defects found alongside them. It writes no Web UI code.

The plan follows the four pull requests the specification defines. Each pull request is independently reviewable and independently revertable, and each leaves `bun test`, `bun run typecheck`, and `bun run lint` green.

The specification records all 26 findings without rephrasing. This plan does the same. Every task below cites the finding numbers it closes, and each task leaves the repository in a state where the suite passes.

## Architecture Decisions

- **A new `src/services/` layer owns document loading.** `loadDocumentContext` and `readManifest` move out of `src/server/routes.ts` into `src/services/document.ts`. Both the CLI and the HTTP adapter import the service. This is the single change that unblocks the Web UI, and it fixes finding 3 and finding 9 together because they are the same move.
- **Services stay pure ports.** A service function takes plain values and returns a plain result object. `process.cwd()` stops being a default parameter, services stop writing to the terminal, and the module-level template cache moves to its caller. The translate service already has this shape through its `ModelRunner` injection, so the pattern is extended rather than invented.
- **The domain layer is not touched.** `src/model/` keeps its purity. The only change is that it gains the two id helpers that finding 10 requires, and it already owns `createManifest`, so they belong there.
- **Duplication is resolved upward, into `src/shared/`.** `escapeHtml` and `detectImageFormat` have no domain knowledge, so they land in the layer both their callers may import. The unit-id helpers are domain knowledge, so they land in `src/model/project.ts` beside `createManifest`, which already produces them.
- **Atomicity is a service concern.** Finding 4 moves `deleteDocumentParts` onto the same write-temporary-then-rename pattern that `writeExtractedDocument` already uses at `src/extract/writer.ts:129-149`. The pattern is copied, not extracted, because the two operations are not yet similar enough to justify a shared abstraction.
- **Tests become colocated unit tests, and the integration layer goes.** The seven files under `tests/integration/` are deleted. The 43 tests they hold are the only end-to-end cover, and the specification accepts that gap for the duration of this ticket. The 17 files under `tests/unit/` stay where they are, and none of their 119 tests may be deleted or weakened.
- **The two defects ship first, with a test that proves each.** Finding 1 has no real coverage today, because the only test that touches `--report` asserts nothing about the report file. A colocated failing test is written before each fix.
- **`exactOptionalPropertyTypes` is fixed in the option types, not the tsconfig.** Finding 21 uses the `force?: boolean | undefined` idiom that `src/commands/translate.ts:12-26` and `src/translate/types.ts:105-117` already use. Relaxing the compiler flag is an "ask first" item and is not done here.

## Dependency Graph

```text
Delete tests/integration/  (baseline: 162 -> 119)
              |
      +-------+-------+
      |               |
      v               v
Finding 1 test+fix  Finding 2 test+fix
(--report)          (cache on failure)
      |               |
      +-------+-------+
              |
              v
Create src/services/document.ts (+ colocated test)
              |
              v
Repoint build / routes / delete / translate to the service
              |
      +-------+--------+---------+
      |       |        |         |
      v       v        v         v
cwd       console   template   atomic
defaults  removal    cache      delete
  (5)        (6)       (7)       (4)
      |       |        |         |
      +-------+--------+---------+
              |
              v
     Shared escapeHtml (8)  ----  unit id helpers (10)  ----  detectImageFormat (11)
              |                          |                          |
              +------------+-------------+-------------+------------+
                           |
                           v
              O(n^2) removal (15) + the five nits (19, 22, 23, 24, 25)
                           |
                           v
     countUnits (13) + DocumentManifest (14) + assertNotSymlink (16)
                           |
              +------------+-------------+
              |                          |
              v                          v
     max-cost (17) + asset ids (18)    tsconfig idiom (20, 21)
              |                          |
              +------------+-------------+
                           |
                           v
                  JSDoc sweep (12, 26)
```

## Implementation Order

1. Delete the integration tests and record the 119 baseline. Every later count depends on this.
2. Prove each defect with a failing colocated test, then fix it. Findings 1 and 2 are independent of each other and of everything after.
3. Create `src/services/document.ts`. It has no callers yet, so it cannot break anything.
4. Repoint the four callers. The HTTP adapter stops owning the loading rule.
5. Remove the `process.cwd()` defaults, the terminal writes, and the module-level cache. Three small mechanical passes, in that order, because the first one changes signatures the later two touch.
6. Make `deleteDocumentParts` atomic. It runs last in its pull request because it is the riskiest change there.
7. Extract `escapeHtml`, then the unit-id helpers, then `detectImageFormat`. The id helpers go before the image sniffing, because the id helpers are the ones with a real regression risk.
8. Clear the O(n²) lookups and the five nits. Mechanical, low risk, one commit.
9. Remove `countUnits`, type the manifest, and fix `assertNotSymlink`.
10. Fix the cost accounting, the asset-id uniqueness, and the `exactOptionalPropertyTypes` idioms.
11. Add the JSDoc blocks last, once the code has stopped moving. Writing documentation before the refactor finishes means writing it twice.

## Task List

### Phase 1: Test baseline and the two defects (Pull Request 1)

- [ ] **Task 1: Delete the integration tests and record the 119 baseline**
  - Finding: none. This is the testing decision from the specification.
  - Acceptance: `tests/integration/` no longer exists. `bun test` reports exactly 119 passing and 0 failing across 17 files. `tests/unit/` and `tests/fixtures/` are untouched.
  - Verify: `bun test` shows `119 pass / 0 fail`. `git status` shows the seven files as deleted and nothing else.
  - Files: `tests/integration/build.test.ts`, `tests/integration/delete.test.ts`, `tests/integration/extract.test.ts`, `tests/integration/pipeline.test.ts`, `tests/integration/serve.test.ts`, `tests/integration/translate-command.test.ts`, `tests/integration/translate.test.ts`
  - Depends: None

- [ ] **Task 2: Pin finding 1 with a failing test, then pass the report path through**
  - Finding: 1 (Critical) — `--report` never reaches `translateDocument`.
  - Acceptance: a colocated test calls `runTranslate` with `report: "reports/custom.md"` and asserts `custom.md` exists under the output project. The test fails before the fix and passes after. `reportPath` is forwarded at `src/commands/translate.ts:130`.
  - Verify: `bun test src/commands/translate.test.ts`. Confirm the test fails when the one-line fix is reverted.
  - Files: `src/commands/translate.test.ts` (new), `src/commands/translate.ts`
  - Depends: Task 1 (the old coverage is gone, so this test is the only one)

- [ ] **Task 3: Pin finding 2 with a failing test, then write the cache on a failed run**
  - Finding: 2 (Major) — the early return at `src/translate/translate.ts:533` skips `writeCache`, so paid work is re-billed.
  - Acceptance: a colocated test runs a translation in which one unit fails and asserts `translation.cache.json` exists afterward, with an entry for each unit that succeeded. The test fails before the fix and passes after. The cache write happens before the early return.
  - Verify: `bun test src/translate/translate.test.ts`. Confirm the test fails when the cache write is moved back below the return.
  - Files: `src/translate/translate.test.ts` (new), `src/translate/translate.ts`
  - Depends: Task 1

### Checkpoint: Pull Request 1

- [ ] `bun test` reports 119 passing or more with 0 failures
- [ ] `bun run typecheck` and `bun run lint` pass
- [ ] Both new tests were observed failing before their fix
- [ ] No file under `tests/` was added or modified

### Phase 2: The service layer (Pull Request 2)

- [ ] **Task 4: Create `src/services/document.ts` with the document loader and its test**
  - Findings: 3, 9 (part one) — the loading rule lives in a route module.
  - Acceptance: `src/services/document.ts` exports the loader and the manifest reader, moved from `src/server/routes.ts:31-79`. The module imports no adapter, and no `Bun.serve`. A colocated test loads a document from a path with no server running.
  - Verify: `bun test src/services/document.test.ts`. Confirm by inspection that the module has no import from `src/server/`, `src/render/`, or `src/commands/`.
  - Files: `src/services/document.ts` (new), `src/services/document.test.ts` (new)
  - Depends: Task 1

- [ ] **Task 5: Repoint the four callers to the service**
  - Findings: 3, 9 (part two) — `src/commands/build.ts:5` imports the HTTP layer, and `readManifest` is duplicated at `src/server/routes.ts:31` and `src/commands/delete.ts:54`, with a third variant at `src/translate/translate.ts:129-141`.
  - Acceptance: `src/commands/build.ts`, `src/server/routes.ts`, `src/commands/delete.ts`, and `src/translate/translate.ts` all import the one loader. The private `readManifest` copies are deleted. No file under `src/services/`, `src/extract/`, or `src/translate/` imports an adapter.
  - Verify: `bun run typecheck`, `bun test`. Grep: `rg -n "from \"\\.\\./(server|render|commands)/" src/services src/extract src/translate` returns nothing.
  - Files: `src/commands/build.ts`, `src/server/routes.ts`, `src/commands/delete.ts`, `src/translate/translate.ts`
  - Depends: Task 4

- [ ] **Task 6: Remove the `process.cwd()` default parameters**
  - Finding: 5 (Major) — the default hides the value a Web UI and a test must control.
  - Acceptance: `src/commands/serve.ts:6` and `src/commands/extract.ts:7` take `repositoryRoot` as a required parameter. The CLI passes `process.cwd()` explicitly at the call site. No `process.cwd()` default remains anywhere in `src/`.
  - Verify: `bun run typecheck`, `bun test`. Grep: `rg -n "process\\.cwd" src/` shows only the explicit call sites in `src/cli.ts`.
  - Files: `src/commands/serve.ts`, `src/commands/extract.ts`, `src/cli.ts`
  - Depends: Task 5

- [ ] **Task 7: Remove the terminal writes from the service layer**
  - Finding: 6 (Major) — `src/commands/serve.ts:14` and `src/render/pdf.ts:84` write to the terminal.
  - Acceptance: no `console.*` and no `process.exit` remains in `src/services/`, `src/extract/`, `src/translate/`, or `src/render/`. `runServe` returns the server and its address as data. The PDF renderer returns the skipped images as data. The adapters print. `src/markdown/from-html-bridge.ts:8-9` keeps its `console.error` and `process.exit(2)`, because that file is a subprocess whose exit code is how it reports failure to its parent.
  - Verify: `bun test`. Grep: `rg -n "console\\.|process\\.exit" src/` shows only `src/cli.ts`.
  - Files: `src/commands/serve.ts`, `src/render/pdf.ts`, `src/commands/build.ts`
  - Depends: Task 6

- [ ] **Task 8: Move the template cache out of module scope**
  - Finding: 7 (Major) — `src/render/template.ts:44` caches a filesystem read process-wide, so the result depends on call order.
  - Acceptance: no module-level mutable state remains in `src/render/template.ts`. The caller owns the cache lifetime. The fallback to the built-in templates still works when no document directory is given.
  - Verify: `bun test tests/unit/render.test.ts`, `bun test src/commands/build.test.ts`
  - Files: `src/render/template.ts`, `src/render/html.ts`
  - Depends: Task 5

- [ ] **Task 9: Make `deleteDocumentParts` atomic**
  - Finding: 4 (Major) — `src/commands/delete.ts:113-124` deletes every unit file, then writes the replacements, with no rollback.
  - Acceptance: the rewritten chapters go to a temporary directory and are swapped into place, following the pattern at `src/extract/writer.ts:129-149`. A failure mid-write leaves the original unit files readable. A colocated test proves it.
  - Verify: `bun test src/commands/delete.test.ts`. Confirm the original files survive an induced write failure.
  - Files: `src/commands/delete.ts`, `src/commands/delete.test.ts` (new)
  - Depends: Task 5

- [ ] **Task 10: Write `src/AGENTS.md`**
  - Finding: none. This is the specification's requirement that the layer rules survive the next contributor.
  - Acceptance: `src/AGENTS.md` states the four-layer table from the specification, the rule that a service never imports an adapter, the rule that `process.cwd()` is not a default, the rule that services do not write to the terminal, and the colocated-test rule.
  - Verify: review. Read it against the layer contract in the specification.
  - Files: `src/AGENTS.md` (new)
  - Depends: Tasks 4, 5, 6, 7, 8, 9

### Checkpoint: Pull Request 2

- [ ] Grep: no service imports an adapter
- [ ] Grep: no `process.cwd()` default, no `console.*`, no `process.exit` below the adapter layer
- [ ] Grep: no module-level mutable cache in `src/render/template.ts`
- [ ] `bun run typecheck`, `bun run lint`, `bun test` all pass
- [ ] `src/AGENTS.md` exists and matches the specification

### Phase 3: The duplication pass (Pull Request 3)

- [ ] **Task 11: Extract one `escapeHtml` into `src/shared/`**
  - Finding: 8 (Major, security) — three copies at `src/render/html.ts:18`, `src/render/template.ts:29`, and `src/commands/build.ts:88`. Divergent escaping is a security bug, not a style nit.
  - Acceptance: `escapeHtml` is defined exactly once in `src/`. All three call sites import it. A colocated test covers `&`, `<`, `>`, `"`, and `'`.
  - Verify: `bun test src/shared/escape.test.ts`. Grep: `rg -n "const escapeHtml" src/` returns exactly one line.
  - Files: `src/shared/escape.ts` (new), `src/shared/escape.test.ts` (new), `src/render/html.ts`, `src/render/template.ts`, `src/commands/build.ts`
  - Depends: Task 10

- [ ] **Task 12: Centralize the unit-id and unit-path conventions**
  - Finding: 10 (Major, highest regression risk in this pull request) — the format is written out in six places: `src/model/project.ts:138`, `src/commands/delete.ts:27,32`, `src/extract/pdf.ts:161,177,196`, `src/extract/epub.ts:645,653`.
  - Acceptance: `nextUnitId(index)` and `nextUnitPath(index, title)` live in `src/model/project.ts` and are the only producers of the unit-id and unit-path format. `createManifest` uses them. All six former sites call them. A colocated test pins the exact current format, so a format change is deliberate rather than accidental. The three `asset-` id and asset-path sites at `src/extract/pdf.ts:114-115` and `src/extract/epub.ts:251` are a separate convention that finding 10 does not cover, so they are left alone and noted instead.
  - Verify: `bun test src/model/project.test.ts`, `bun test tests/unit/`. Grep: `rg -n 'padStart\(3' src/` shows the two helpers plus the three untouched `asset-` sites, and no other unit-id or unit-path template.
  - Files: `src/model/project.ts`, `src/model/project.test.ts` (new), `src/commands/delete.ts`, `src/extract/pdf.ts`, `src/extract/epub.ts`
  - Depends: Task 10

- [ ] **Task 13: Extract one `detectImageFormat` into `src/shared/`**
  - Finding: 11 (Major) — magic-byte sniffing at `src/extract/epub.ts:123-153`, `src/extract/pdf.ts:72-96`, and inline at `src/render/pdf.ts:71-77`.
  - Acceptance: image signature detection exists in exactly one place in `src/`. All three call sites use it. A colocated test covers PNG, JPEG, GIF, WebP, and one unknown signature.
  - Verify: `bun test src/shared/image.test.ts`, `bun test tests/unit/epub.test.ts tests/unit/pdf.test.ts`
  - Files: `src/shared/image.ts` (new), `src/shared/image.test.ts` (new), `src/extract/epub.ts`, `src/extract/pdf.ts`, `src/render/pdf.ts`
  - Depends: Task 10

- [ ] **Task 14: Replace the O(n²) lookups in the translate path**
  - Finding: 15 (Minor) — `Array.find` inside a loop over all units at `src/translate/translate.ts:495-513, 282-290, 524`.
  - Acceptance: the lookups use the `Map` already built at `src/translate/translate.ts:515`. The per-unit cost accounting and the report output are unchanged.
  - Verify: `bun test src/translate/translate.test.ts`, `bun test tests/unit/translate-orchestration.test.ts`
  - Files: `src/translate/translate.ts`
  - Depends: Task 12

- [ ] **Task 15: Clear the five minor findings**
  - Findings: 19, 22, 23, 24, 25 (Minor and Nit) — the dead optional chain at `src/commands/build.ts:82`, the repeated `ordered[0]?.` at `src/translate/translate.ts:551-554`, the duplicated `DEFAULT_CONCURRENCY` at `src/commands/translate.ts:111`, the misleading `parseUnits` name at `src/commands/translate.ts:65`, and the inline option types at `src/commands/extract.ts:5-7` and `src/commands/serve.ts:4-6`.
  - Acceptance: each of the five is resolved. `src/commands/extract.ts` and `src/commands/serve.ts` export named option types, matching `BuildDocumentOptions`, `DeleteDocumentOptions`, and `TranslateCommandOptions`. No behavior changes.
  - Verify: `bun run typecheck`, `bun run lint`, `bun test`
  - Files: `src/commands/build.ts`, `src/commands/translate.ts`, `src/translate/translate.ts`, `src/commands/extract.ts`, `src/commands/serve.ts`
  - Depends: Tasks 11, 12, 13, 14

### Checkpoint: Pull Request 3

- [ ] Grep: `escapeHtml` is defined once, image sniffing exists once, the id format is produced once
- [ ] `bun test src/model/project.test.ts` pins the unit-id format
- [ ] `bun run typecheck`, `bun run lint`, `bun test` all pass

### Phase 4: Rules, types, and robustness (Pull Request 4)

- [ ] **Task 16: Remove `countUnits` and close the `--only` validation hole**
  - Finding: 13 (Major) — `src/commands/translate.ts:152-162` skips `validateManifest`, builds a path by string concatenation, and returns `Number.POSITIVE_INFINITY` when the manifest is missing, so any `--only` value passes the range check.
  - Acceptance: `countUnits` is deleted. The unit count comes from the validated source project. `--only 999` against a 2-unit document is rejected with a validation error. A colocated test proves it. This is the test the `Infinity` return silently permits today.
  - Verify: `bun test src/commands/translate.test.ts`. Confirm `--only 999` throws.
  - Files: `src/commands/translate.ts`, `src/commands/translate.test.ts`
  - Depends: Task 15

- [ ] **Task 17: Type the manifest as `DocumentManifest`**
  - Finding: 14 (Major) — `src/commands/build.ts:53-54,101-102` types the parameter as `Parameters<typeof renderIndexPage>[0]`.
  - Acceptance: the manifest parameter is `DocumentManifest`. The call sites read as a contract a Web UI author can follow without reading the render module.
  - Verify: `bun run typecheck`
  - Files: `src/commands/build.ts`
  - Depends: Task 15

- [ ] **Task 18: Fix the error-string matching in `assertNotSymlink`**
  - Finding: 16 (Minor) — `src/shared/paths.ts:47-62` re-throws by matching `error.message.startsWith("Symbolic links")`, and flattens a real `ENOENT` or permission error into "Unable to inspect path" with the cause dropped.
  - Acceptance: the function uses a typed error or an explicit flag rather than a message match. The `ENOENT` and permission paths keep their own cause. No new code in `src/` matches on an error message string.
  - Verify: `bun test tests/unit/paths.test.ts`, `bun test src/services/document.test.ts`
  - Files: `src/shared/paths.ts`
  - Depends: Task 15

- [ ] **Task 19: Count the cost of every billed outcome**
  - Finding: 17 (Minor) — the `--max-cost` check at `src/translate/translate.ts:403` runs before the call, and only successful units add to `spent` at `:466`. Truncated and failed units cost real money (`:440`, `:460`) and are never counted.
  - Acceptance: every billed outcome adds its cost to `spent`. The concurrency overshoot is documented in the JSDoc, because removing it would require serializing the pool. A colocated test asserts a truncated unit reports its cost.
  - Verify: `bun test src/commands/translate.test.ts`
  - Files: `src/translate/translate.ts`, `src/commands/translate.test.ts`
  - Depends: Task 16

- [ ] **Task 20: Enforce unique asset ids**
  - Finding: 18 (Minor) — `src/model/project.ts:225-232` checks unit ids and paths for uniqueness, never asset ids. `src/extract/writer.ts:77-79` keys `assetPaths` by asset id, so a duplicate id silently collapses two assets into one path.
  - Acceptance: `validateManifest` rejects a manifest with two assets sharing an id, with the same message style as the existing unit-id check. A colocated test proves it. No valid manifest produced by `createManifest` is rejected.
  - Verify: `bun test src/model/project.test.ts`, `bun test tests/unit/model.test.ts`
  - Files: `src/model/project.ts`, `src/model/project.test.ts`
  - Depends: Task 12

- [ ] **Task 21: Use the `exactOptionalPropertyTypes` idiom instead of conditional spreads**
  - Findings: 20, 21 (Minor) — the flag at `tsconfig.json:12` forces 8 or more conditional spreads, such as `src/commands/serve.ts:11-12` and `src/extract/batch.ts:69,140`.
  - Acceptance: the option types declare `force?: boolean | undefined`, matching the idiom at `src/commands/translate.ts:12-26` and `src/translate/types.ts:105-117`. The conditional spreads are gone. `tsconfig.json` is unchanged, and no runtime behavior changes. The dead `string` branch in `parseNumber` is removed with the spread it served.
  - Verify: `bun run typecheck`, `bun run lint`, `bun test`. Grep: `rg -n '\.\.\.\(.*=== undefined \? \{\}' src/` returns nothing.
  - Files: `src/commands/translate.ts`, `src/extract/batch.ts`, `src/commands/serve.ts`, and the option types they share
  - Depends: Tasks 6, 15

- [ ] **Task 22: Add the missing JSDoc blocks**
  - Findings: 12, 26 (Major, Nit) — 24 functions have no JSDoc block, against the root `AGENTS.md` rule "IMPORTANT: Declare a proper JSDoc block for every function". The list is `src/extract/epub.ts` at lines 57, 67, 71, 78, 86, 94, 113, 123, 155, 157, 161, 175, 197, 473, 492, 503. `src/translate/validate.ts` at 30, 40, 145. `src/translate/translate.ts:36`. `src/markdown/from-html-bridge.ts` at 6, 12, 13, 14. Plus the missing explanatory comment on the cast at `src/translate/translate.ts:104`.
  - Acceptance: every one of the 24 functions carries a JSDoc block written in English, following the `technical-writing` skill, with a blank line before the body. The cast at `:104` carries one line explaining the external-SDK boundary. The function count and the file set are otherwise unchanged, because finding 12 adds documentation and does not restructure `src/extract/epub.ts`.
  - Verify: `bunx biome check .`, `bun run typecheck`, `bun test`. Count: no arrow-const function in `src/` lacks a JSDoc block.
  - Files: `src/extract/epub.ts`, `src/translate/validate.ts`, `src/translate/translate.ts`, `src/markdown/from-html-bridge.ts`
  - Depends: Tasks 12, 13, 19. This task runs last so the documentation is written once, after the code stops moving.

### Checkpoint: Pull Request 4 and the ticket

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun test` reports 119 passing or more with 0 failures
- [ ] All 24 functions from finding 12 have a JSDoc block
- [ ] The throwaway Web UI adapter compiles and runs, with no change to `src/model/`, `src/shared/`, `src/extract/`, or `src/translate/`. The adapter is deleted after the check.
- [ ] `package.json` `dependencies` is unchanged
- [ ] All 19 success criteria in `roadmap/T0003/spec.md` are met

## Parallelization Opportunities

**Safe to parallelize:**

- Task 2 and Task 3 touch different files (`src/commands/translate.ts` and its test, versus `src/translate/translate.ts` and its test) and close different findings.
- Tasks 16, 17, 18, and 20 are independent single-file changes with no shared dependency.
- Task 10, the `src/AGENTS.md` write, is documentation and can proceed alongside any code task in Phase 2, once the layer table is settled.

**Must be sequential:**

- Task 4 before Task 5. The service must exist before callers adopt it.
- Task 5 before Tasks 6, 8, and 9. They all edit files that Task 5 repoints.
- Task 6 before Task 7. Task 6 changes the signature that Task 7 edits.
- Task 12 before Task 14. The id helpers change the manifest that the O(n²) fix reads.
- Task 12 before Task 22. The JSDoc sweep would document code that Task 12 then rewrites.

**Conflict warning:** Tasks 12 and 13 both edit `src/extract/epub.ts` and `src/extract/pdf.ts`. Do not run them in parallel. Task 12 runs first, because the unit-id format carries the higher regression risk.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Task 12 changes the unit-id or unit-path format, which silently invalidates every existing document project | High | The colocated test pins the exact current format before the helpers are extracted. `createManifest` output is asserted unchanged. No format change is intended. |
| Deleting the integration tests removes the only end-to-end cover for all five commands | High | Accepted by the specification, recorded as Open Question 3, and named for a follow-up ticket. Phase checkpoints run all five commands by hand until that ticket lands. |
| Task 9 makes `deleteDocumentParts` atomic, and the new code path has never run against a real project | High | The pattern is copied from `writeExtractedDocument`, which has run since T0001. The test induces a write failure and asserts the originals survive. Task 9 is reviewed on its own. |
| Moving `loadDocumentContext` breaks a caller that is not updated in the same commit | Medium | Task 4 creates the module with no callers, so it cannot break anything. Task 5 repoints all four callers in one commit, and `bun run typecheck` catches a missed one. |
| The 24 JSDoc blocks in Task 22 are written against code that later changes | Medium | Task 22 is last by dependency, so the code is final. |
| Task 21 touches option types shared by several files, and a signature change ripples | Medium | `bun run typecheck` fails on any missed call site. The tsconfig flag is unchanged, so a mistake is a compile error, not a silent behavior change. |
| The four pull requests drift apart and a later one depends on an unreviewed earlier one | Low | Each pull request is independently revertable. Task dependencies are explicit, and the checkpoints name the greps that prove the boundary. |
| Fixing finding 6 removes the PDF "skipped image" warning that operators rely on | Low | The warning moves to the adapter, which prints it. The information is preserved, only the ownership changes. |

## Resolved Decisions

1. **The ticket stops at Web-UI-ready.** No Web UI code, no framework, no route list. Confirmed with the user.
2. **All 26 findings stay in one ticket, bugs first.** The two defects ship in pull request 1 so they do not wait behind the refactor. Confirmed with the user.
3. **The work lands as four pull requests**, not one commit and not one task per finding. Confirmed with the user.
4. **Tests become colocated unit tests, and `tests/integration/` is deleted.** The 43 deleted tests are accepted as a deliberate coverage gap for this ticket, on the basis that the services get a documented, composable API. Confirmed with the user.
5. **`tests/unit/` is not migrated in this ticket.** It keeps its location and its `../../src/` imports. Migration is a later ticket.
6. **`tests/fixtures/` stays.** `tests/unit/epub.test.ts` and `tests/unit/pdf.test.ts` depend on it.
7. **`exactOptionalPropertyTypes` is fixed in the option types, not the tsconfig**, following the idiom already used in the translate option types.
8. **The JSDoc sweep runs last**, after the code stops moving, so the documentation is written once.

## Open Questions

1. **Finding 21** has two valid resolutions. This plan takes the option-type route. Relaxing the `tsconfig.json` flag is an "ask first" item and is not planned.
2. **Finding 17** has a concurrency overshoot that cannot be removed without serializing the worker pool. The plan counts the cost of every billed outcome and documents the overshoot. Strict budgeting is out of scope.
3. **The missing end-to-end safety net** is recorded in the specification as Open Question 3. Until a follow-up ticket restores integration coverage, the five commands are verified by hand at each checkpoint. If you would rather keep an automated net during the refactor, that follow-up ticket should be pulled forward.

## Validation Checklist

Run these before the ticket closes.

- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun run lint` passes with zero errors
- [ ] `bun test` reports 119 passing or more with 0 failures
- [ ] `rg -n "from \"\.\./(server|render|commands)/" src/services src/extract src/translate` returns nothing
- [ ] `rg -n "process\.cwd" src/` shows only explicit call sites in `src/cli.ts`
- [ ] `rg -n "console\.|process\.exit" src/` shows only `src/cli.ts` and the subprocess bridge at `src/markdown/from-html-bridge.ts`
- [ ] `rg -n "const escapeHtml" src/` returns exactly one line
- [ ] `rg -n "padStart\(3" src/` shows only the two id helpers plus the three untouched `asset-` sites
- [ ] Every function listed in finding 12 has a JSDoc block
- [ ] `--report reports/custom.md` writes `custom.md`, proven by `bun test src/commands/translate.test.ts`
- [ ] A failed translate run leaves `translation.cache.json` on disk with the successful entries
- [ ] `--only 999` against a 2-unit document is rejected
- [ ] The throwaway Web UI adapter compiles and runs, then is deleted
- [ ] `git diff package.json` shows no change to `dependencies`
- [ ] `tests/integration/` is gone, and `tests/unit/` is untouched
- [ ] `src/AGENTS.md` states the layer table and the colocated-test rule

## Implementation Status

Not started. Phase 1 begins at Task 1.
