# Spec: T0002 — Parallel Model-Assisted Document Translation

**Ticket:** T0002  
**Title:** Parallel Model-Assisted Document Translation  
**Phase:** Specify  
**Status:** Draft — awaiting human review  
**Depends on:** T0001 (extraction and publishing pipeline)

## Assumptions

1. T0001 is implemented. An extracted document exists under `documents/<document-name>/` with a valid `manifest.json`, ordered Markdown units under `chapters/`, and local images under `assets/images/`.
2. The command translates the Markdown units of one extracted document. It does not re-run extraction and it does not read the original PDF or EPUB.
3. Model access is through the OpenCode Zen gateway. Models are called from the Bun process with the Vercel AI SDK. No model provider is installed or run locally.
4. The operator sets `OPENCODE_API_KEY` in the environment. The repository never stores the key.
5. The first validated target language is French (`--to fr`). The command accepts any BCP-47 language tag and reuses `directionForLanguage` from `src/model/project.ts`.
6. A translated document is a sibling project `documents/<source>-<lang>/`. It is a full standalone project, so `serve` and `build` consume it unchanged.
7. The translated project keeps the unit identifiers and unit paths of the source project. Only titles, body text, `language`, `direction`, `id`, and the document title change.
8. Translation is nondeterministic. The tool guarantees structural fidelity through validation, not through identical wording.
9. Per-unit results are cached by content hash so that reruns, retries, and benchmarks are cheap and resumable. Caching is part of the first release.
10. A human reviews the translated text and the benchmark quality column. Automated checks cover structure, links, and assets, not translation quality.
11. Machine translation sends document text to a third-party model. The operator runs the command only on documents they are allowed to send.

## Objective

Add a `translate` command to the existing Bun and TypeScript toolchain. The command reads one extracted document, translates every Markdown unit into a target language, and writes a translated sibling project that previews and builds with the existing `serve` and `build` commands.

The command runs one model call per Markdown unit and executes the calls in parallel with a bounded worker pool. A model registry selects the model, the endpoint, and the price for each run. A benchmark harness compares candidate models on a fixed sample of real units and writes a review-ready Markdown report with measured time and cost. A human fills the quality rating.

The ticket also answers the investigation question: which models are the best candidates for French, and how should parallel per-unit agents be organized.

### User Stories

- As a publisher, I want `translate --document <name> --to fr` to produce `documents/<name>-fr/` so that I can preview and print a French edition without touching the source.
- As an editor, I want the translated project to keep the source structure, links, and images so that I can review wording instead of hunting for broken references.
- As an operator, I want bounded parallelism and per-unit caching so that a full book finishes quickly and costs little, and a rerun does not pay twice.
- As a cost owner, I want a per-unit and per-model cost report so that I can see where the budget goes.
- As a decision maker, I want a benchmark report that compares candidate models on real French units, with time and cost filled in and a quality column for my review.

## Scope

### In Scope

- One `translate` command for one extracted document and one target language.
- Parallel, per-unit model calls with bounded concurrency.
- A model registry for the OpenCode Zen gateway (endpoint, AI SDK protocol, price).
- A provider layer built on the Vercel AI SDK.
- Structure-preserving translation with automated validation.
- A translated sibling project that `serve` and `build` accept unchanged.
- Per-unit caching and resume.
- Per-unit model, token, duration, and cost accounting.
- Human and machine translation reports.
- A benchmark harness and a `roadmap/T0002/benchmark.md` report for French.
- Offline unit and integration tests with a mocked language model.

### Out of Scope

- Re-extraction, OCR, or reading the source PDF or EPUB.
- Translating image pixels or image files. Alt text is in scope; the image bytes are copied unchanged.
- A per-language glossary or terminology base in the first release.
- Human-review status tracking in the manifest.
- Editing the source project in place.
- Rendering a translated preview inside the source project.
- Automatic quality scoring. A human fills the quality column.
- EPUB export, cloud hosting, and remote access.
- Committing translated text of copyrighted books to version control.
- Multi-document batch translation in the first release.

## Functional Requirements

### Command Surface

`translate` accepts these options:

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--document <name>` | yes | — | Source document directory under `documents/`. |
| `--to <lang>` | yes | — | Target language tag, for example `fr`, `fr-CA`, `de`. |
| `--model <id>` | no | registry default | Model identifier from the registry. |
| `--out-document <name>` | no | `<document>-<lang>` | Output project directory name. |
| `--concurrency <n>` | no | `4` | Maximum number of parallel model calls. |
| `--only <parts...>` | no | all units | Translate only these 1-based unit numbers. |
| `--force` | no | off | Replace a non-empty output project. |
| `--dry-run` | no | off | List jobs and estimated cost, then stop. |
| `--no-cache` | no | cache on | Ignore and do not write the per-unit cache. |
| `--max-cost <usd>` | no | off | Stop before the next call when the run cost exceeds this value. |
| `--report <path>` | no | project `reports/` | Write the Markdown report to this path. |
| `--json` | no | off | Print a machine-readable result summary to stdout. |

Validation rules:

- `--document` must exist under `documents/` and must parse as a valid manifest.
- `--to` must be a valid BCP-47 language tag. Normalize to lower case for the directory name and to the canonical tag for the manifest.
- `--out-document` must satisfy `assertDocumentName` and must not equal the source document.
- The output project must not be the source project.
- A non-empty output project fails without `--force`.
- `--concurrency` must be an integer from 1 to 16.
- Unit numbers in `--only` are 1-based, in range, and unique.

### Output Project

The command writes a complete project with the same layout as T0001:

```text
documents/<source>-<lang>/
  manifest.json          Translated titles, language, direction, copied source metadata
  chapters/
    001-<slug>.md        Same count, order, ids, and paths as the source
    002-<slug>.md
  assets/
    images/              Copied unchanged from the source project
  templates/             Copied unchanged from the source project
  reports/
    translation.md       Human summary
    translation.json     Machine-readable per-unit results
    translation.cache.json   Per-unit cache (see Caching)
  generated/             Disposable HTML and PDF output
```

Manifest changes relative to the source:

- `id` = `<source-id>-<lang>`.
- `title` = the translated document title.
- `language` = the normalized target tag.
- `direction` = `directionForLanguage(language)`.
- `source` = copied unchanged from the source manifest.
- `units[].id` and `units[].path` = copied unchanged from the source manifest.
- `units[].title` = the translated unit title.
- `assets` and `templates` = copied unchanged.

The output manifest must pass `validateManifest`.

If a unit fails and the run continues, the tool has two policies:

- Default (strict): fail the run, write nothing to `chapters/`, and return a non-zero exit code. Partial results stay in the cache.
- `--best-effort`: write the successful units, copy the failed units from the source unchanged, mark them in the report, and return a non-zero exit code.

### Translation Job Contract

One job equals one Markdown unit. The job input is the unit Markdown, the source and target language tags, and the unit title. The job output is translated Markdown with the same structure.

The prompt instructs the model to:

1. Translate all human-readable prose, headings, list items, table cells, captions, and image alternative text into the target language.
2. Keep the Markdown structure: block types, order, heading levels, list markers, table shape, block quotes, and thematic breaks.
3. Keep code blocks, inline code, URLs, and file paths unchanged.
4. Keep every link target and image source unchanged. Translate only the visible link text and the alternative text.
5. Keep internal `/read/<unit-id>` links unchanged.
6. Keep the document title semantics. Do not add commentary, notes, or explanations.
7. Output Markdown only. Do not wrap the result in a code fence.

The prompt lives in `src/translate/prompt.ts` with a version constant. The cache key includes the version.

### Structure Preservation and Validation

The tool must not trust the model output. After each call, `src/translate/validate.ts` compares the translated Markdown to the source Markdown:

- Parse both with `Bun.markdown`.
- Build a structural skeleton: sequence of block kinds, heading levels, list ordered/unordered flags and item counts, blockquote nesting, table row and column counts, thematic break positions, and code block languages.
- Ensure the skeletons match.
- Collect all link hrefs and image sources. Ensure the sets are equal. A changed, added, or removed href or image source is a failure.
- Ensure every internal `/read/<unit-id>` href still points to a unit id in the output project.
- Warn, but do not fail, when the translated length is outside a ratio band (default 0.4 to 2.5 of the source length). Record the warning in the report.

On validation failure, the tool does not call the model again. Asking the same model to repair a structure violation costs tokens and offers no guarantee, so the unit is marked failed, the issues are recorded in the report, and the failure policy applies. A human decides whether to re-run the unit with a different model.

### Provider Layer

The provider layer uses the Vercel AI SDK. The core call is `generateText` from `ai`.

#### Reasoning control

Some models are *thinking-only*: they emit hidden reasoning tokens before any visible text. On a long unit they can spend the whole `maxOutputTokens` budget on reasoning and return **no text at all**, with `finishReason = "length"` and `completion_tokens_details.reasoning_tokens` equal to the cap. This was observed on `glm-5.3-flash` and `deepseek-v4.1-flash` on a 43k-character chapter.

Each registry entry may declare `providerOptions`, which the runner merges under the provider namespace and passes to `generateText`. The namespace comes from `providerOptionsKeyFor(protocol)`: `opencodeZen` for the OpenAI-compatible family, `openai`, and `google`. The AI SDK requires **camelCase** option keys; a snake_case key is silently dropped.

Proven controls:

- DeepSeek: `{ thinking: { type: "disabled" } }` (also `{ chatTemplateKwargs: { enable_thinking: false } }`).
- GLM 5.3 (thinking-only, cannot be disabled): `{ reasoningEffort: "low" }`.
- GPT: `{ reasoningEffort: "low" }` under the `openai` namespace.
- Gemini: `{ thinkingConfig: { thinkingBudget: 0 } }` under the `google` namespace.

`reasoning_effort: "minimal"` is rejected with HTTP 400 by GLM and DeepSeek V4.1.

`src/translate/providers/registry.ts` holds a model registry. Each entry declares:

```ts
export type ModelEntry = {
  id: string;                 // Logical id used by --model
  zenModel: string;           // Model id sent to the gateway
  protocol: "openai-compatible" | "google" | "openai" | "anthropic";
  label: string;
  pricing: { input: number; output: number; cachedRead?: number }; // USD per 1M tokens
  contextWindow: number;
  supportsTemperature: boolean;
};
```

`src/translate/providers/zen.ts` builds an AI SDK language model from an entry:

- `openai-compatible` → `createOpenAICompatible({ name: "opencode-zen", apiKey, baseURL })` from `@ai-sdk/openai-compatible`.
- `google` → `createGoogleGenerativeAI({ apiKey, baseURL })` from `@ai-sdk/google`.
- `openai` → `createOpenAI({ apiKey, baseURL })` from `@ai-sdk/openai`.
- `anthropic` → `createAnthropic({ apiKey, baseURL })` from `@ai-sdk/anthropic`.

Environment:

- `OPENCODE_API_KEY` — required. The gateway API key.
- `OPENCODE_ZEN_BASE_URL` — optional. Default `https://opencode.ai/zen/v1`.

The gateway exposes different protocols per model family. The initial registry covers the OpenAI-compatible family and the Google family. The OpenAI and Anthropic protocols are defined in the registry type and added only when the benchmark needs them.

A missing key, an unknown model id, or an unsupported protocol fails with an actionable error before any unit is translated.

### Concurrency, Retry, and Resume

- Run jobs through a bounded worker pool. The default concurrency is 4. The maximum is 16.
- Retry a call twice with exponential backoff. Retry only on network errors, rate limits, and server errors, which produce no billable response. Never retry a validation failure.
- Preserve result order in reports and in the manifest regardless of completion order.
- Cache every successful unit result. The cache key is a hash of the model id, target language, prompt version, and source unit Markdown.
- On rerun, reuse a cached result when the key matches and skip the model call.
- `--no-cache` ignores and does not write the cache.

### Cost and Usage Accounting

- Read `usage.inputTokens` and `usage.outputTokens` from the AI SDK result.
- Compute the unit cost from the registry price for the selected model.
- Accumulate per-unit and per-run cost.
- `--max-cost` stops the run before the next call when the accumulated cost exceeds the limit. Units that did not run are marked skipped.
- `--dry-run` estimates input tokens from the source character count, predicts output tokens from the same count, and reports the estimated total cost for the selected model. It makes no model call.

### Translation Reports

`reports/translation.md` is a short human summary:

- Source document, target language, model, and prompt version.
- Unit count, translated count, cached count, failed count, and skipped count.
- Total input tokens, output tokens, duration, and cost.
- Warnings, grouped by unit.
- Failed units with the error message and the validation errors.

`reports/translation.json` is a stable machine-readable record:

- One entry per unit: unit id, title, status, model, cached flag, duration, input tokens, output tokens, cost, and validation warnings.
- Run totals and the prompt version.
- No secrets and no API key.

### Benchmark Harness

The benchmark compares candidate models on the same real units. It runs one model at a time with concurrency 1 so that duration is comparable.

The harness is a one-off tool for the model choice. It is **not** part of the shipped command-line interface.

- `scripts/benchmark-translate.ts` holds the harness and its own command-line entry point.
- Run it with `bun scripts/benchmark-translate.ts …` or `bun run benchmark:translate -- …`.
- The harness selects a fixed sample of units from a document. The default sample covers one short unit, one long unit, one list or table unit, and one image-heavy unit.
- For each candidate model and each sample unit, the harness records duration, input tokens, output tokens, and cost.
- The harness **stores the translated Markdown of every model** under a review directory (`--output <dir>`, default `<report dir>/benchmark-output/<model>/<unit file>`), and copies the source images once to `<output dir>/assets/images/` so the stored chapters resolve their image links. A translation is stored even when the structure check fails, because a human must be able to read it and give a quality note.
- The harness writes `roadmap/T0002/benchmark.md` (or `--report <path>`).
- The harness writes raw results to `roadmap/T0002/benchmark.json` for reproducibility.
- When a model stops because it reached the output cap (`finishReason = "length"`), the row is marked failed with a truncation message. A truncated answer is never reported as a structure failure.

`roadmap/T0002/benchmark.md` contains:

1. Run metadata: date, source document, target language, prompt version, sample unit list.
2. A per-model detail table with a filled time and cost and an empty quality column:

| Model | Unit | Chars | Duration (s) | Input tok | Output tok | Cost (USD) | Quality /10 | Notes |
|-------|------|-------|--------------|-----------|------------|------------|-------------|-------|
| ...   | ...  | ...   | ...          | ...       | ...        | ...        |             |       |

3. A summary table with an empty verdict column:

| Model | Units | Total duration (s) | Total cost (USD) | Avg Quality /10 | Verdict |
|-------|-------|--------------------|------------------|-----------------|---------|
| ...   | ...   | ...                | ...              |                 |         |

The instructions in the report tell the reviewer to fill the `Quality /10` column per unit and the `Avg Quality /10` and `Verdict` columns. The tool never fills the quality columns.

### Candidate Models for the French Benchmark

The registry starts with a low-cost shortlist for French. Prices are USD per 1M tokens from the OpenCode Zen catalog at the time of this spec. The list is ordered by rising input price.

| Candidate | Zen model id | Protocol | Input | Output | Rationale |
|-----------|--------------|----------|-------|--------|-----------|
| GPT 6 Luna | `gpt-6-luna` | openai | $0.10 | $0.50 | Cheapest strong option. |
| DeepSeek V4 Flash | `deepseek-v4-flash` | openai-compatible | $0.14 | $0.28 | Lowest expected cost. |
| GLM 5.3 Flash | `glm-5.3-flash` | openai-compatible | $0.15 | $0.50 | Low cost, strong European languages. |
| GPT 5.6 Luna | `gpt-5.6-luna` | openai | $0.20 | $1.20 | Second cheap GPT tier. |
| DeepSeek V4.1 Flash | `deepseek-v4.1-flash` | openai-compatible | $0.30 | $1.20 | Balance of quality and cost. |
| MiniMax M3 | `minimax-m3` | openai-compatible | $0.30 | $1.20 | Independent provider for comparison. |
| Gemini 3.5 Flash Lite | `gemini-3.5-flash-lite` | google | $0.30 | $2.50 | Cheapest Gemini. |
| Gemini 3 Flash | `gemini-3-flash` | google | $0.50 | $3.00 | Mid Gemini. |
| GLM 5.3 | `glm-5.3` | openai-compatible | $1.40 | $4.40 | Premium GLM, quality ceiling at low volume. |

Models that were evaluated and dropped: `deepseek-v4-pro` (no gateway route), `qwen3.8-flash` (Anthropic family, out of scope), `kimi-k2.5` (no gateway route), `claude-sonnet-5` (too expensive for this task), and the free models (`longcat-2.5-preview-free` and peers), because the free tier can only be used from inside OpenCode, not from the API.

## Commands

```bash
# Install dependencies
bun install

# Translate one document into French (sibling project)
bun run translate -- --document steve-krug-don-t-make-me-think-1984 --to fr

# Choose a model and a bounded concurrency
bun run translate -- --document <name> --to fr --model deepseek-v4.1-flash --concurrency 6

# Estimate cost without calling a model
bun run translate -- --document <name> --to fr --model gemini-3-flash --dry-run

# Translate a subset of units
bun run translate -- --document <name> --to fr --only 3 4 5

# Replace an existing translation
bun run translate -- --document <name> --to fr --force

# Run the French benchmark and write the review report
bun scripts/benchmark-translate.ts --document <name> --to fr

# Run tests
bun test --coverage

# Run static checks
bun run lint
bun run typecheck
```

## Tech Stack

- **Runtime:** Bun with the built-in `fetch`.
- **Language:** TypeScript in strict mode.
- **CLI:** Commander, consistent with T0001.
- **Model calls:** Vercel AI SDK. Core package `ai` with provider packages `@ai-sdk/openai-compatible`, `@ai-sdk/google`, and, when needed, `@ai-sdk/openai` and `@ai-sdk/anthropic`.
- **Gateway:** OpenCode Zen at `https://opencode.ai/zen/v1`.
- **Markdown parsing:** `Bun.markdown`, already used for rendering.
- **Hashing:** `Bun.CryptoHasher` or `crypto.subtle` for cache keys.
- **Tests:** `bun test` with `ai/test` (`MockLanguageModelV3`) for offline model behavior.

## Project Structure

New source files:

```text
src/
  commands/
    translate.ts             Thin command handler
  translate/
    translate.ts             Orchestration: jobs, worker pool, resume, writing
    prompt.ts                Prompt assembly and prompt version
    validate.ts              Structural skeleton comparison
    cache.ts                 Per-unit cache read and write
    report.ts                translation.md and translation.json writers
    benchmark.ts             Benchmark harness and report tables
    types.ts                 Translation job, result, and summary types
    providers/
      registry.ts            Model registry (id, protocol, price, context)
      zen.ts                 AI SDK provider construction for Zen
tests/
  unit/
    translate-prompt.test.ts
    translate-validate.test.ts
    translate-cache.test.ts
    translate-registry.test.ts
    translate-cost.test.ts
  integration/
    translate.test.ts        Full pipeline with a mocked model
    benchmark.test.ts        Benchmark harness with a mocked model
  fixtures/
    translate/               Small unit fixtures and expected skeletons
```

Reused files: `src/model/project.ts` (`validateManifest`, `directionForLanguage`, `serializeManifest`), `src/shared/paths.ts` (`assertDocumentName`, `resolveDocumentRoot`), `src/shared/errors.ts` (`AppError`, `ValidationError`), and the `serve` and `build` commands unchanged.

## Code Style

Follow T0001 conventions. Strict TypeScript. `camelCase` for values, `kebab-case` for file names. A JSDoc block for every function. A blank line before `if`, loops, and `return`. Arrow functions only. No `any`. Use discriminated unions for job and validation results. Keep the model call behind the provider layer and keep validation pure.

Example of the orchestration shape:

```ts
export type TranslateResult = {
  outputDir: string;
  translated: number;
  cached: number;
  failed: number;
  skipped: number;
  costUsd: number;
};

export const translateDocument = async (
  options: TranslateOptions,
  repositoryRoot: string
): Promise<TranslateResult> => {
  const source = await loadSourceProject(repositoryRoot, options.document);
  const jobs = buildJobs(source, options);
  const results = await runPool(jobs, options.concurrency, (job) => translateUnit(job, options));
  await writeProject(source, jobs, results, options);

  return summarize(results);
};
```

## Testing Strategy

### Unit Tests

- Prompt assembly includes the target language, the structure rules, and the prompt version.
- Skeleton extraction for headings, lists, tables, block quotes, code, and thematic breaks.
- Validation accepts a faithful translation and rejects a changed href, a changed image source, a missing heading, and a changed table shape.
- Cache key stability and cache hit and miss behavior.
- Registry lookup, unknown model rejection, and price and cost math.
- Dry-run token and cost estimation.
- Language and output-name validation, including the source-equals-output rejection.

### Integration Tests

- Translate a small fixture project with a mocked model. Verify the sibling project, the unchanged ids and paths, the translated titles, the copied assets, and a valid manifest.
- Verify that `serve` and `build` accept the translated project.
- Verify the strict failure policy writes no chapters and exits non-zero.
- Verify `--best-effort` copies the failed units from the source and reports them.
- Verify retry on a network error and no retry on a validation failure.
- Verify resume: a second run with the same cache makes no model call.
- Verify `--force` replaces an existing output project and that a non-empty project fails without `--force`.
- Verify path safety: an output name that escapes `documents/` is rejected.
- Run the benchmark harness with a mocked model and verify the report tables and the empty quality columns.

Tests must not call a real model. Use `ai/test` mocks and an injected fake provider. Tests must pass without `OPENCODE_API_KEY` and without network access.

### Manual Verification

- Run the benchmark on a real document and hand `roadmap/T0002/benchmark.md` to a human reviewer.
- Translate a real document into French and preview it with `serve`.
- Build HTML and PDF from the translated project.
- Confirm the source project is byte-for-byte unchanged.

## Boundaries

### Always

- Validate the source document, the target language, the model id, and the output name before any model call.
- Keep the source project unchanged.
- Preserve unit ids, unit paths, link targets, and image sources.
- Validate every model response before writing it.
- Report failures and warnings instead of hiding them.
- Record the model, prompt version, token usage, and cost for every unit.
- Run tests, lint, and type checks before completion.
- Keep API keys out of the repository, logs, and reports.

### Ask First

- Add a model provider package beyond `@ai-sdk/openai-compatible` and `@ai-sdk/google`.
- Add a new AI SDK dependency, or change the AI SDK version.
- Change the `manifest.json` schema or the sibling-project contract.
- Change the public CLI command names or flags.
- Add a glossary, a translation memory, or a second content model.
- Translate a copyrighted book and write the result into version control.

### Never

- Commit the API key, source books, or copyrighted translations.
- Modify or delete the source document or the source PDF or EPUB.
- Send content to a model that trains on user data for a whole-book run by default.
- Write an unvalidated model response into a chapter file.
- Silently drop a unit, a warning, or a failed resource.
- Treat the translated project as the source of truth.
- Remove or weaken a failing test to make a build pass.

## Success Criteria

The ticket is complete when all of the following are true:

1. `bun run translate -- --document <name> --to fr` creates `documents/<name>-fr/` with a manifest that validates and has `language = "fr"` and the correct direction.
2. The output project keeps the unit count, ids, order, and paths of the source, copies assets and templates, and translates unit titles and body text.
3. `serve --document <name>-fr` and `build --document <name>-fr --format html|pdf` work with no change to those commands.
4. Structural validation rejects a changed href, a changed image source, and a changed heading or table shape. A failed unit is never written.
5. Unit calls run in parallel with bounded concurrency, and results keep source order.
6. A unit that fails validation follows the documented strict or best-effort policy, the run returns a non-zero exit code, and the model is not called again for that unit.
7. Per-unit caching makes a rerun skip unchanged units, and `--no-cache` disables it.
8. Reports list per-unit model, duration, tokens, cost, and warnings, and the run totals.
9. `--dry-run` estimates cost without a model call, and `--max-cost` stops the run at the limit.
10. The benchmark harness writes `roadmap/T0002/benchmark.md` with measured time and cost and empty quality and verdict columns, plus `roadmap/T0002/benchmark.json`.
11. The command produces an actionable error for a missing key, an unknown model, an unknown document, an invalid language tag, and an unsafe output name.
12. `bun test --coverage`, `bun run lint`, and `bun run typecheck` pass without network access.
13. The source project is unchanged after a run.

## Open Questions

- Which exact units form the fixed benchmark sample, and how many candidate models does the first benchmark run?
- Does the Zen Google endpoint accept AI SDK `generateText` through `@ai-sdk/google` with the `https://opencode.ai/zen/v1` base URL, or does it need a different base path? Confirm before the Gemini rows are added.
- Does the Zen gateway return token usage for every protocol, so cost math is exact rather than estimated?
- Which model is the default when `--model` is omitted, before the benchmark is reviewed?
- Should the translated document title fall back to the source title when the title page has no clear title?
- Which documents in `sources/` may be sent to a model, given copyright?
- Is a small per-language glossary worth adding in a later ticket for names and domain terms?
- Should a later ticket add a second target language and a right-to-left validation case?
