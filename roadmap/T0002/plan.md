# Implementation Plan: T0002 — Parallel Model-Assisted Document Translation

**Ticket:** T0002  
**Title:** Parallel Model-Assisted Document Translation  
**Phase:** Plan  
**Status:** Planned — awaiting human review  
**Specification:** `roadmap/T0002/spec.md`  
**Depends on:** T0001 (implemented)

## Overview

Add a `translate` command to the existing Bun and TypeScript toolchain. The command reads one extracted document under `documents/`, translates every Markdown unit into a target language through parallel per-unit model calls, validates every response for structural fidelity, and writes a standalone sibling project `documents/<source>-<lang>/` that `serve` and `build` consume unchanged. The implementation also delivers a model registry over the Vercel AI SDK and the OpenCode Zen gateway, per-unit caching with resume, cost and usage accounting, translation reports, and a benchmark harness that writes a review-ready Markdown report for French with measured time and cost and an empty human quality column.

The implementation follows vertical slices: each phase produces a testable path from a translated unit to a written, validated, reportable result.

## Architecture Decisions

- Model calls go through the **Vercel AI SDK** (`ai` core `generateText`). A small provider factory (`zen.ts`) maps a registry entry to an AI SDK language model, so protocol differences between Zen model families stay inside one file.
- A **model registry** is data, not code. Each entry declares the Zen model id, the AI SDK protocol, the label, the context window, and the USD-per-1M-token price. Adding a candidate is a registry edit, not a code change.
- One job equals one Markdown unit. A **bounded worker pool** (default concurrency 4, maximum 16) executes jobs in parallel; results are reassembled in source order.
- The model output is never trusted. A **skeleton validator** compares block kinds, heading levels, list and table shapes, link targets, image sources, and `/read/` targets before anything is written. A structure violation is never retried: the unit fails and is reported.
- Unit ids, unit paths, assets, and templates are **copied from the source manifest**; only titles, body text, language, direction, and document id and title change. This guarantees link integrity inside the sibling project.
- A **per-unit cache** keyed by hash(model, language, prompt version, source Markdown) makes reruns, `--force` replacements, and benchmark runs cheap.
- Tests use **mocked language models** (`ai/test` `MockLanguageModelV3`) and never touch the network. The benchmark harness is the only production consumer of live models.
- Cost accounting reads `usage` from the AI SDK result and multiplies by registry prices; the key comes from `OPENCODE_API_KEY` and never reaches disk, logs, or reports.

## Dependency Graph

```text
AI SDK dependencies and package scripts
              |
              v
Translate types, model registry, Zen provider factory
              |
      +-------+------------------+
      |                          |
      v                          v
Prompt assembly            Skeleton validation
      |                          |
      +-------+------------------+
              |
              v
Per-unit cache and worker pool orchestration
              |
              v
Sibling-project writer (manifest, chapters, assets, templates)
              |
      +-------+------------------+
      |                          |
      v                          v
CLI command wiring        Translation reports (.md / .json)
              |                          |
              +-------+------------------+
                       v
               Benchmark harness + benchmark.md / benchmark.json
                       |
                       v
             Real-document acceptance (French) and human review
```

## Implementation Order

1. Add the AI SDK dependencies and package scripts, then verify no regression.
2. Build the model registry, the Zen provider factory, and cost math.
3. Build the prompt assembly and the skeleton validator (pure, no I/O).
4. Build the cache, the worker pool, and the orchestration that writes the sibling project.
5. Wire the CLI command with its options, policies, and error handling.
6. Write the translation reports.
7. Build the benchmark harness and its report tables.
8. Run real-document acceptance, publish the benchmark for human review, and document the workflow.

## Task List

### Phase 1: Foundation

- [x] **Task 1: Add the AI SDK dependencies and package scripts**
  - Acceptance: `ai`, `@ai-sdk/openai-compatible`, and `@ai-sdk/google` are installed (`ai/test` available for tests). `package.json` gains `translate` and `benchmark:translate` scripts. T0001 tests, lint, and typecheck still pass.
  - Verify: `bun install`, `bun test`, `bun run lint`, `bun run typecheck`.
  - Files: `package.json`, `bun.lock`
  - Depends: None
  - Scope: Small

- [x] **Task 2: Define translate types, the model registry, and the Zen provider factory**
  - Acceptance: `src/translate/types.ts` defines job, unit result, run summary, and option types with discriminated unions for status and validation outcomes. `registry.ts` holds the candidate entries from the spec (DeepSeek V4 Pro/Flash/4.1 Flash, Qwen3.8 Flash, GLM 5.3 Flash, Gemini 3.5 Flash Lite / 3 Flash) with protocol and USD pricing. `zen.ts` builds an AI SDK model per protocol from `OPENCODE_API_KEY` and `OPENCODE_ZEN_BASE_URL` and throws actionable errors for a missing key, an unknown id, and an unsupported protocol. Cost math converts tokens to USD per model.
  - Verify: `bun test tests/unit/translate-registry.test.ts tests/unit/translate-cost.test.ts`, `bun run typecheck`. Table-driven tests for lookup, errors, and cost rounding.
  - Files: `src/translate/types.ts`, `src/translate/providers/registry.ts`, `src/translate/providers/zen.ts`, `tests/unit/translate-registry.test.ts`, `tests/unit/translate-cost.test.ts`
  - Depends: Task 1
  - Scope: Medium

- [x] **Task 3: Build prompt assembly and skeleton validation**
  - Acceptance: `prompt.ts` produces the system and user prompts from unit Markdown, title, and language pair, enforces the spec's structural rules, and exports a prompt version constant. `validate.ts` extracts a structural skeleton from Markdown via `Bun.markdown` (block kinds, heading levels, list flags and item counts, table rows/columns, blockquotes, thematic breaks, code-block languages), compares skeletons, compares link and image targets, checks `/read/` targets against the output project, and emits a warn-only length-ratio band (0.4–2.5). Validation is pure and injectable.
  - Verify: `bun test tests/unit/translate-prompt.test.ts tests/unit/translate-validate.test.ts`. Fixtures cover faithful translation, changed href, dropped heading, reshaped table, and added/removed image.
  - Files: `src/translate/prompt.ts`, `src/translate/validate.ts`, `tests/unit/translate-prompt.test.ts`, `tests/unit/translate-validate.test.ts`, `tests/fixtures/translate/`
  - Depends: Task 2 (types only)
  - Scope: Medium

### Checkpoint: Foundation

- [x] Dependencies install cleanly; AI SDK version pinned in `package.json` and `bun.lock`.
- [x] Registry, cost math, prompt, and validator are covered by unit tests.
- [x] Structural validation demonstrably rejects the mutation cases from the spec.
- [ ] Review with human before orchestration work proceeds.

### Phase 2: Core Orchestration

- [x] **Task 4: Implement the cache, worker pool, and translate orchestration**
  - Acceptance: `cache.ts` stores successful unit results under the output project at `reports/translation.cache.json`, keyed by hash(model, language, prompt version, source Markdown), with hit/miss reads and `--no-cache` bypass. `translate.ts` builds jobs from a loaded source manifest, runs them through a bounded worker pool (default 4, max 16, validated range), reorders results to source order, retries network/rate-limit/server errors twice with backoff, validates every response once with no corrective retry, then applies the failure policy: strict (default) writes nothing and exits non-zero; `--best-effort` copies failed units from the source and marks them. Writes the sibling project: manifest via T0001 validators (`validateManifest`, `directionForLanguage`), translated units to identical paths, copied `assets/` and `templates/`, cache file, and refuses a non-empty project without `--force`.
  - Verify: `bun test tests/integration/translate.test.ts tests/unit/translate-cache.test.ts`. Integration tests use an injected fake model: happy path (2–3 units), unchanged ids/paths, valid manifest, validation failure with a single model call then strict failure, best-effort copy, cache hit on rerun, `--force` behavior, assets copied.
  - Files: `src/translate/cache.ts`, `src/translate/translate.ts`, `tests/unit/translate-cache.test.ts`, `tests/integration/translate.test.ts`, `tests/fixtures/epub/make-fixture.ts`
  - Depends: Tasks 2 and 3
  - Scope: Large (5 files) — orchestrator plus cache split keeps it movable

- [x] **Task 5: Wire the `translate` CLI command**
  - Acceptance: `src/commands/translate.ts` and `src/cli.ts` expose `translate --document <name> --to <lang> [--model <id>] [--out-document <name>] [--concurrency <n>] [--only <parts...>] [--force] [--dry-run] [--no-cache] [--max-cost <usd>] [--report <path>] [--best-effort] [--json]`. Validation mirrors the spec: BCP-47 `--to`, output name ≠ source and satisfies `assertDocumentName`, valid manifest source, 1-based in-range `--only`, `1..16` concurrency, non-empty target requires `--force`. `--dry-run` estimates tokens (characters/4 heuristic) and cost without a call; `--max-cost` stops before the next call and marks remaining units skipped. Exit non-zero on failed units; console summary in human mode, machine summary with `--json`. `serve` and `build` remain untouched.
  - Verify: `bun test tests/integration/translate.test.ts tests/unit/cli.test.ts`. Parse-level CLI tests confirm option mapping (parts→numbers, concurrency, json flag) and the error messages for unknown document, bad language, and unsafe output name.
  - Files: `src/commands/translate.ts`, `src/cli.ts`, `package.json`, `tests/integration/translate.test.ts`
  - Depends: Task 4
  - Scope: Medium

### Checkpoint: Core Orchestration

- [x] A mocked-model run produces a sibling project that `serve` and `build` accept unchanged.
- [x] Strict and best-effort failure policies and retry/backoff behavior covered by integration tests.
- [x] Cache resume: a second run makes zero model calls.
- [ ] Review with human before report and benchmark work.

### Phase 3: Reports and Benchmark

- [x] **Task 6: Write translation reports**
  - Acceptance: `report.ts` writes `reports/translation.md` (run metadata; translated/cached/failed/skipped counts; totals and cost; warnings and failures grouped by unit) and `reports/translation.json` (per-unit model, cached flag, duration, input/output tokens, cost, status; run totals; prompt version; no secrets). `--report <path>` relocates the Markdown report. Reports are stable, deterministic, and sorted by unit order.
  - Verify: `bun test tests/integration/translate.test.ts` (report content assertions) and a focused `tests/unit/translate-report.test.ts`.
  - Files: `src/translate/report.ts`, `tests/unit/translate-report.test.ts`, `tests/integration/translate.test.ts`
  - Depends: Task 4
  - Scope: Small

- [x] **Task 7: Build the benchmark harness and report**
  - Acceptance: `benchmark.ts` runs fixed sample units (short, long, list/table, image-heavy) per candidate model at concurrency 1, records duration and per-unit tokens/cost, and writes `roadmap/T0002/benchmark.md` (or `--report <path>`) plus `roadmap/T0002/benchmark.json`. The Markdown report contains the run metadata, the per-model detail table with filled time/cost and **empty Quality /10 columns**, the summary table with empty `Avg Quality /10` and `Verdict` columns, and reviewer instructions. The tool never fills quality or verdict cells.
  - Verify: `bun test tests/integration/benchmark.test.ts` with a mocked model; assert table structure, empty quality cells, and raw JSON completeness. `bun run benchmark:translate -- --document <name> --to fr --dry-run` lists the plan without key requirement.
  - Files: `src/translate/benchmark.ts`, `tests/integration/benchmark.test.ts`, `package.json`
  - Depends: Tasks 2, 4, and 6 (parallel-safe with Task 5)
  - Scope: Medium

### Checkpoint: Reports and Benchmark

- [x] Reports and benchmark artifacts are deterministic and test-covered.
- [x] Benchmark output matches the spec's table template exactly.
- [ ] Review with human before live benchmark runs.

### Phase 4: Validation and Documentation

- [~] **Task 8: Real-document acceptance, live benchmark, and documentation**
  - Acceptance: With `OPENCODE_API_KEY` set: run the live French benchmark on the real document, produce `roadmap/T0002/benchmark.md` with measured rows, hand the quality columns to the human reviewer, and record the chosen default model in the registry. Translate a real document end-to-end (`--to fr`), preview with `serve`, build HTML and PDF, and confirm the source project is unchanged. Update `README.md` (translate command, model selection, key handling, benchmark review workflow) and the root Glossary if needed. Full regression green.
  - Verify: `bun test --coverage`, `bun run lint`, `bun run typecheck`; manual `translate`, `serve`, and `build` runs against a real extracted document; `git status` confirms sources and books stay untracked and unchanged.
  - Files: `roadmap/T0002/benchmark.md`, `README.md`, `roadmap/T0002/plan.md` (status), tests touched only for regressions
  - Depends: Tasks 5, 6, and 7
  - Scope: Medium

### Checkpoint: Complete

- [~] Every Task 1 through Task 8 acceptance criterion is checked.
- [x] All tests, lint checks, and type checks pass.
- [~] The translated French project previews and builds; the source project is unchanged.
- [ ] `roadmap/T0002/benchmark.md` is published for human quality review.
- [x] The implementation plan and specification match the public CLI behavior.

## Parallelization Opportunities

- Tasks 2 and 3 are independent after Task 1's types land; coordinate only through `src/translate/types.ts`.
- Tasks 6 and 7 depend on Task 4 but are independent of each other and of Task 5; they can run in parallel once the orchestrator contract is stable.
- The live benchmark in Task 8 must follow Tasks 5–7 and needs the API key; no parallelism there.
- Do not parallelize edits to `package.json`, the manifest, or the shared model contracts.
- Fixture authoring (`tests/fixtures/translate/`) can proceed beside Tasks 2–3.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Models return Markdown that breaks structure (fences, dropped headings, rewritten links) | High | Strict skeleton validation before write; no corrective retry, so cost stays bounded; failed units never written and are reported for human triage; strict policy exits non-zero. |
| Zen serves different protocols per model family; Google path through AI SDK unverified | High | Registry isolates protocol; Task 2 adds `openai-compatible` first, Google second behind one factory; confirm the Gemini base path before adding Google rows (spec Open Question). |
| Token usage may be missing for some protocols, making cost inexact | Medium | Use real usage when present; otherwise mark cost as estimated in reports; record `usage` raw values. |
| Whole-book run costs exceed budget | Medium | `--dry-run` estimate, `--max-cost` stop guard, `--only` subsets, and per-unit cache keep reruns cheap. |
| Rate limits or transient failures in parallel runs | Medium | Bounded pool, exponential backoff with two retries, resume from cache, non-zero exit with per-unit status. |
| Models train on submitted data for free tiers | High | Excluded from the default recommendation; document the privacy caveat in the benchmark report. |
| Translated text of copyrighted books enters version control | High | Translated projects stay outside git like the source projects; document the boundary. |
| Worker pool complexity adds flaky ordering | Medium | Pool returns per-job results; reassembly happens by source order in one place, tested with shuffled completion order. |
| Mock-model tests pass but live models differ in usage reporting | Medium | Benchmark harness records raw usage; Task 8 cross-checks on a real run before baselining cost. |

## Resolved Decisions

- Model access: Vercel AI SDK core `ai` + `@ai-sdk/openai-compatible` and `@ai-sdk/google`, pointed at the Zen gateway. The `openai` and `anthropic` protocols are typed in the registry and added only if the benchmark requires them.
- Gateway key: `OPENCODE_API_KEY` environment variable; base URL overridable via `OPENCODE_ZEN_BASE_URL`.
- Output contract: standalone sibling project; unit ids and paths copied from the source; assets and templates copied.
- Failure policy: strict by default; `--best-effort` copies failed source units and marks them.
- Caching: on by default, keyed by model + language + prompt version + source Markdown hash; `--no-cache` disables.
- Default model before benchmark review: routed through the registry default; final default set in Task 8 after human review.
- Prompt versioning: constant in `prompt.ts`, part of the cache key.

## Open Questions

- Exact benchmark sample units and the final candidate model list (decided at Task 8 review; the registry already contains the spec's shortlist).
- Gemini-through-Zen base path confirmation for `@ai-sdk/google` (spec Open Question; verify before adding Google rows).
- Whether the workspace supplies a Zen key with per-model access and spending limits for whole-book runs.

## Validation Checklist

- [x] Every task has acceptance criteria and a verification step.
- [x] Task dependencies are ordered; foundation tasks go first.
- [x] No task touches more than ~5 files (Task 4 is the largest and is scoped to 5).
- [x] Checkpoints exist after each phase.
- [x] The human reviews and approves the plan before implementation starts.

## Implementation Status

Tasks 1 through 7 are implemented and verified. 176 tests pass, the type check and Biome are clean, and the full pipeline runs against the live OpenCode Zen gateway.

Resolved during implementation:

- **Gateway endpoints.** The Console models table gives the base `https://opencode.ai/zen/v1`. The OpenAI-compatible family uses `Authorization: Bearer` on `/chat/completions`, the OpenAI family uses the same header on `/responses`, and the Google family uses `x-goog-api-key` on `/models/<id>:generateContent`. The `@ai-sdk/anthropic` and `@ai-sdk/openai` packages were removed at first, then `@ai-sdk/openai` was restored for the GPT candidates; `@ai-sdk/anthropic` stays out because no candidate uses it.
- **Final candidate set.** Nine models, ordered by rising input price: `gpt-6-luna`, `deepseek-v4-flash`, `glm-5.3-flash`, `gpt-5.6-luna`, `deepseek-v4.1-flash`, `minimax-m3`, `gemini-3.5-flash-lite`, `gemini-3-flash`, `glm-5.3`. Dropped: `deepseek-v4-pro` and `kimi-k2.5` (no gateway route), `qwen3.8-flash` (Anthropic family, out of scope), `claude-sonnet-5` (too expensive), and the free models (the free tier only works inside OpenCode).
- **Output cap.** Some families default to 4096 output tokens and would truncate a long chapter. Every entry declares `maxOutputTokens`, set to 16384, and the runner passes it to `generateText`.
- **Truncation detection.** A response with `finishReason = "length"` is reported as a truncation, never as a structure failure.
- **Stored translations.** The benchmark stores the translated Markdown of every model so a human can read it and assign a quality note, and links each stored file from the report. Without this the Quality /10 column cannot be filled.

Open items:

- Task 8 remains in progress: the live benchmark on `unit-011` is running, and the quality column is waiting for human review.
- The default model stays `deepseek-v4.1-flash` until the quality review completes.

### Reasoning-burn fix and benchmark merge

The first live benchmark stored no text for `glm-5.3-flash`, `deepseek-v4.1-flash`, and `glm-5.3`: the capped calls returned exactly `maxOutputTokens` output tokens with an empty body and `finishReason = "length"`. A raw probe proved the cause: `completion_tokens_details.reasoning_tokens` equalled the cap, so the models spent the whole budget on hidden reasoning. These are thinking-only models.

Fixes:

- Registry entries gained `providerOptions`, merged under the provider namespace by `providerOptionsKeyFor` and passed to `generateText`. `deepseek-v4.1-flash` uses `{ thinking: { type: "disabled" } }`; `glm-5.3-flash` and `glm-5.3` use `{ reasoningEffort: "low" }` because GLM 5.3 rejects `thinking: { type: "disabled" }`.
- The benchmark gained `--merge`, so a partial rerun keeps the stored rows, summaries, and translations of the models that did not run. Without it, retrying two models would have discarded the other seven results and the review files already read by the human.

Rerun of the two fixed models, merged into the existing report:

| Model | Before | After |
|-------|--------|-------|
| `glm-5.3-flash` | 110.8 s, $0.0097, empty | 86.9 s, $0.0076, structure ok |
| `deepseek-v4.1-flash` | 221.2 s, $0.0227, empty | 200.3 s, $0.0187, structure ok |

`glm-5.3` carries the same registry fix but was not rerun, so its stored output is still empty. `deepseek-v4-flash` stays in the comparison with its original result.

### Benchmark leaves the command-line interface

The benchmark was a temporary experiment to choose a translation model. The choice is done. The benchmark is not a shipped feature, so it is removed from the command-line interface and kept as a one-off tool.

- The code moved from `src/translate/benchmark.ts` and `src/commands/benchmark.ts` into `scripts/benchmark-translate.ts`, which holds the harness and its own entry point.
- Run it with `bun scripts/benchmark-translate.ts …` or `bun run benchmark:translate -- …`.
- `src/cli.ts` no longer registers `benchmark-translate`.
- The benchmark tests were removed with the command.

The chosen model is `gpt-6-luna`. It had the best quality and the lowest cost in the live review.

