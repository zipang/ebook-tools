import { cp, mkdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { Command } from "commander";
import { ValidationError } from "../src/shared/errors.ts";
import { buildSystemPrompt, buildUserPrompt, TRANSLATION_PROMPT_VERSION } from "../src/translate/prompt.ts";
import { estimateCostUsd, findModel, listModels } from "../src/translate/providers/registry.ts";
import {
	buildJobs,
	createModelRunner,
	loadSourceProject,
	normalizeLanguageTag,
	withRetry
} from "../src/translate/translate.ts";
import type { ModelEntry, ModelRunner, TranslateJob } from "../src/translate/types.ts";
import { stripOuterCodeFence, validateTranslation } from "../src/translate/validate.ts";

/**
 * Compare candidate translation models on one document.
 *
 * This tool is a one-off experiment. It is not part of the shipped command-line
 * interface. It stores one translation per model, measures the time and the
 * cost, and writes a review report for a human reviewer.
 */

/** Options accepted by the benchmark harness. */
export type BenchmarkOptions = {
	document: string;
	to: string;
	models?: string[] | undefined;
	only?: number[] | undefined;
	reportPath: string;
	outputDir?: string | undefined;
	dryRun?: boolean | undefined;
	/** Keep the existing rows of models that are not in this run. */
	merge?: boolean | undefined;
};

/** One planned benchmark run for a model. */
export type BenchmarkPlanRow = {
	model: string;
	units: number;
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	estimatedCostUsd: number;
};

/** One measured benchmark row. */
export type BenchmarkRow = {
	model: string;
	unitId: string;
	unitTitle: string;
	chars: number;
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	ok: boolean;
	/** Stored translation, relative to the report directory. */
	outputPath?: string | undefined;
	error?: string | undefined;
};

/** Summary of one model in the benchmark. */
export type BenchmarkSummary = {
	model: string;
	units: number;
	totalDurationMs: number;
	totalCostUsd: number;
	failed: number;
};

/** Result of a benchmark run. */
export type BenchmarkResult = {
	document: string;
	language: string;
	models: string[];
	rows: BenchmarkRow[];
	summaries: BenchmarkSummary[];
	reportPath: string;
	jsonPath: string;
	dryRun: boolean;
	plan: BenchmarkPlanRow[];
};

/** Estimate the tokens and the cost of one model over the sample. */
export const estimateBenchmarkCost = (entry: ModelEntry, jobs: TranslateJob[]): BenchmarkPlanRow => {
	const estimatedInputTokens = jobs.reduce(
		(total, job) => total + Math.ceil((job.markdown.length + job.unitTitle.length + 200) / 4),
		0
	);
	const estimatedOutputTokens = jobs.reduce((total, job) => total + Math.ceil(job.markdown.length / 4), 0);

	return {
		model: entry.id,
		units: jobs.length,
		estimatedInputTokens,
		estimatedOutputTokens,
		estimatedCostUsd: estimateCostUsd(entry, {
			noCacheTokens: estimatedInputTokens,
			cacheReadTokens: 0,
			outputTokens: estimatedOutputTokens
		})
	};
};

/** Read the previous benchmark rows when a merge is requested. */
const readExistingRows = async (merge: boolean | undefined, jsonPath: string): Promise<BenchmarkRow[]> => {
	if (!merge) {
		return [];
	}

	const file = Bun.file(jsonPath);

	if (!(await file.exists())) {
		return [];
	}

	try {
		const parsed = (await file.json()) as { rows?: BenchmarkRow[] };

		return Array.isArray(parsed.rows) ? parsed.rows : [];
	} catch {
		return [];
	}
};

/** Return true when a directory exists. */
const directoryExists = async (path: string): Promise<boolean> => {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
};

/** The units of a benchmark sample. */
export type BenchmarkSample = {
	sourceLanguage: string;
	jobs: TranslateJob[];
};

/** Load the units of a benchmark sample, in manifest order. */
export const selectSampleUnits = async (
	repositoryRoot: string,
	documentName: string,
	only?: number[]
): Promise<BenchmarkSample> => {
	const source = await loadSourceProject(repositoryRoot, documentName);

	return { sourceLanguage: source.manifest.language, jobs: await buildJobs(source, only) };
};

/** Format a cost in US dollars. */
const usd = (value: number): string => value.toFixed(4);

/** Format a duration in milliseconds as seconds. */
const seconds = (value: number): string => (value / 1000).toFixed(2);

/** Resolve the directory that holds one translation per model. */
const resolveReviewDir = (options: BenchmarkOptions, reportPath: string): string => {
	if (!options.outputDir) {
		return join(dirname(reportPath), "benchmark-output");
	}

	return isAbsolute(options.outputDir) ? options.outputDir : join(process.cwd(), options.outputDir);
};

/** Resolve the document directory that holds the source assets. */
const sourceDocumentDir = (repositoryRoot: string, documentName: string): string =>
	join(repositoryRoot, "documents", documentName);

/** Copy the source images once, so stored chapters resolve their image links. */
const copyReviewAssets = async (sourceDir: string, reviewDir: string): Promise<void> => {
	const from = join(sourceDir, "assets");

	if (!(await directoryExists(from))) {
		return;
	}

	await cp(from, join(reviewDir, "assets"), { recursive: true });
};

/** Store one translated unit and return its path relative to the report. */
const storeTranslation = async (
	reviewDir: string,
	reportPath: string,
	model: string,
	job: TranslateJob,
	translated: string
): Promise<string> => {
	const fileName = basename(job.unitPath);
	const target = join(reviewDir, model, fileName);

	await mkdir(dirname(target), { recursive: true });
	await Bun.write(target, translated);

	return relative(dirname(reportPath), target).replaceAll("\\", "/");
};

/** Render the human review report. */
export const renderBenchmarkMarkdown = (input: {
	document: string;
	language: string;
	generatedAt: string;
	rows: BenchmarkRow[];
	summaries: BenchmarkSummary[];
}): string => {
	const lines: string[] = [
		"# Translation benchmark",
		"",
		`- Source: \`${input.document}\``,
		`- Target language: \`${input.language}\``,
		`- Prompt version: \`${TRANSLATION_PROMPT_VERSION}\``,
		`- Generated: ${input.generatedAt}`,
		"",
		"## How to review",
		"",
		"1. Open the stored translation linked in the `Unit` column. One file exists per model and per unit.",
		"2. Give a quality note from 0 to 10 in the `Quality /10` column of the detail table.",
		"3. Repeat for every unit, then fill `Avg Quality /10` and `Verdict` in the summary table.",
		"4. Keep the cheapest model that reaches your quality bar.",
		"",
		"The tool never fills the quality columns. A structure failure is reported in the `Notes` column.",
		"",
		"## Detail",
		"",
		"| Model | Unit | Chars | Duration (s) | Input tok | Output tok | Cost (USD) | Quality /10 | Notes |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
	];

	for (const row of input.rows) {
		const unitCell = row.outputPath ? `[\`${row.unitId}\`](${row.outputPath})` : `\`${row.unitId}\``;

		lines.push(
			`| \`${row.model}\` | ${unitCell} | ${row.chars} | ${seconds(row.durationMs)} | ${
				row.inputTokens
			} | ${row.outputTokens} | ${usd(row.costUsd)} |  | ${row.ok ? "" : (row.error ?? "failed")} |`
		);
	}

	lines.push(
		"",
		"## Summary",
		"",
		"| Model | Units | Total duration (s) | Total cost (USD) | Avg Quality /10 | Verdict |",
		"| --- | --- | --- | --- | --- | --- |"
	);

	for (const summary of input.summaries) {
		lines.push(
			`| \`${summary.model}\` | ${summary.units} | ${seconds(summary.totalDurationMs)} | ${usd(
				summary.totalCostUsd
			)} |  |  |`
		);
	}

	return `${lines.join("\n")}\n`;
};

/** Run the benchmark over the candidate models and write the review report. */
export const runBenchmark = async (
	options: BenchmarkOptions,
	repositoryRoot: string,
	deps: { runModel?: ModelRunner } = {}
): Promise<BenchmarkResult> => {
	const language = normalizeLanguageTag(options.to);
	const modelIds =
		options.models && options.models.length > 0 ? options.models : listModels().map((entry) => entry.id);
	const entries = modelIds.map((id) => findModel(id));
	const sample = await selectSampleUnits(repositoryRoot, options.document, options.only);
	const reportPath = isAbsolute(options.reportPath)
		? options.reportPath
		: join(repositoryRoot, options.reportPath);
	const jsonPath = reportPath.replace(/\.md$/, ".json");

	if (options.dryRun) {
		const plan = entries.map((entry) => estimateBenchmarkCost(entry, sample.jobs));

		return {
			document: options.document,
			language,
			models: modelIds,
			rows: [],
			summaries: [],
			reportPath,
			jsonPath,
			dryRun: true,
			plan
		};
	}

	const runModel = deps.runModel ?? createModelRunner();
	const system = buildSystemPrompt({ to: language, from: sample.sourceLanguage });
	const rows: BenchmarkRow[] = [];
	const reviewDir = resolveReviewDir(options, reportPath);
	await copyReviewAssets(sourceDocumentDir(repositoryRoot, options.document), reviewDir);

	for (const entry of entries) {
		for (const job of sample.jobs) {
			const startedAt = Date.now();
			let row: BenchmarkRow;

			try {
				const answer = await withRetry(() =>
					runModel({
						entry,
						system,
						user: buildUserPrompt({
							title: job.unitTitle,
							markdown: job.markdown,
							to: language,
							from: sample.sourceLanguage
						}),
						markdown: job.markdown
					})
				);
				const translated = stripOuterCodeFence(answer.text);
				const truncated = answer.finishReason === "length";
				const outputPath = await storeTranslation(reviewDir, reportPath, entry.id, job, translated);
				const outcome = validateTranslation({
					sourceMarkdown: job.markdown,
					translatedMarkdown: translated,
					unitIds: new Set(sample.jobs.map((item) => item.unitId))
				});

				row = {
					model: entry.id,
					unitId: job.unitId,
					unitTitle: job.unitTitle,
					chars: job.markdown.length,
					durationMs: Date.now() - startedAt,
					inputTokens: answer.usage.noCacheTokens + answer.usage.cacheReadTokens,
					outputTokens: answer.usage.outputTokens,
					costUsd: estimateCostUsd(entry, answer.usage),
					ok: outcome.ok && !truncated,
					outputPath,
					error: truncated
						? `Model output was truncated at maxOutputTokens=${entry.maxOutputTokens}`
						: outcome.ok
							? undefined
							: outcome.issues.map((issue) => issue.message).join(" ")
				};
			} catch (error) {
				row = {
					model: entry.id,
					unitId: job.unitId,
					unitTitle: job.unitTitle,
					chars: job.markdown.length,
					durationMs: Date.now() - startedAt,
					inputTokens: 0,
					outputTokens: 0,
					costUsd: 0,
					ok: false,
					error: `Model call failed: ${String(error)}`
				};
			}

			rows.push(row);
			console.log(
				`${row.model} ${row.unitId}: ${seconds(row.durationMs)}s, $${usd(row.costUsd)}, ${
					row.error === undefined ? "structure ok" : row.error
				}`
			);
		}
	}

	const existingRows = await readExistingRows(options.merge, jsonPath);
	const keptRows = existingRows.filter((row) => !modelIds.includes(row.model));
	const allRows = [...keptRows, ...rows];
	const registryOrder = new Map(listModels().map((entry, index) => [entry.id, index]));
	const allModels = [...new Set(allRows.map((row) => row.model))].sort(
		(left, right) =>
			(registryOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
			(registryOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
	);
	const orderedRows = [...allRows].sort(
		(left, right) => (registryOrder.get(left.model) ?? 0) - (registryOrder.get(right.model) ?? 0)
	);
	const summaries: BenchmarkSummary[] = allModels.map((model) => {
		const own = orderedRows.filter((row) => row.model === model);

		return {
			model,
			units: own.length,
			totalDurationMs: own.reduce((total, row) => total + row.durationMs, 0),
			totalCostUsd: Number(own.reduce((total, row) => total + row.costUsd, 0).toFixed(6)),
			failed: own.filter((row) => !row.ok).length
		};
	});

	const generatedAt = new Date().toISOString();

	await mkdir(dirname(reportPath), { recursive: true });
	await Bun.write(
		reportPath,
		renderBenchmarkMarkdown({
			document: options.document,
			language,
			generatedAt,
			rows: orderedRows,
			summaries
		})
	);
	await Bun.write(
		jsonPath,
		`${JSON.stringify(
			{
				document: options.document,
				language,
				promptVersion: TRANSLATION_PROMPT_VERSION,
				generatedAt,
				models: allModels,
				rows: orderedRows,
				summaries
			},
			null,
			2
		)}\n`
	);

	return {
		document: options.document,
		language,
		models: allModels,
		rows: orderedRows,
		summaries,
		reportPath,
		jsonPath,
		dryRun: false,
		plan: []
	};
};

/** Validate the model selection against the registry. */
const validateModels = (models: string[] | undefined): void => {
	if (models && models.length === 0) {
		throw new ValidationError("--models must contain at least one model id");
	}

	for (const id of models ?? []) {
		if (!listModels().some((entry) => entry.id === id)) {
			throw new ValidationError(
				`Unknown model id: ${id}. Known model ids: ${listModels()
					.map((entry) => entry.id)
					.join(", ")}`
			);
		}
	}
};

/** Create the command-line program of the benchmark tool. */
export const createBenchmarkProgram = (): Command => {
	const program = new Command();

	program
		.name("benchmark-translate")
		.description("Compare candidate translation models and write a review report")
		.requiredOption("--document <name>", "Directory name under documents/")
		.requiredOption("--to <lang>", "Target language tag, for example fr")
		.option("--models <ids...>", "Model identifiers to compare")
		.option("--only <parts...>", "Benchmark only these 1-based unit numbers")
		.option("--report <path>", "Markdown report path", "roadmap/T0002/benchmark.md")
		.option("--output <dir>", "Directory for the per-model translated output")
		.option("--dry-run", "List the models, units, and estimated cost without calling a model")
		.option("--merge", "Keep the existing results of models that are not in this run")
		.action(
			async (options: {
				document: string;
				to: string;
				models?: string[];
				only?: string[];
				report: string;
				output?: string;
				dryRun?: boolean;
				merge?: boolean;
			}) => {
				validateModels(options.models);

				const result = await runBenchmark(
					{
						document: options.document,
						to: options.to,
						models: options.models,
						only: options.only?.map(Number),
						reportPath: options.report,
						outputDir: options.output,
						dryRun: options.dryRun,
						merge: options.merge
					},
					process.cwd()
				);

				if (result.dryRun) {
					for (const row of result.plan) {
						console.log(
							`${row.model}: ${row.units} unit(s), ~${row.estimatedInputTokens} input tok, ~${row.estimatedOutputTokens} output tok, ~$${row.estimatedCostUsd.toFixed(4)}`
						);
					}

					return;
				}

				console.log(`Benchmark report written to ${result.reportPath}`);
				console.log(`Raw results written to ${result.jsonPath}`);
			}
		);

	return program;
};

if (import.meta.main) {
	await createBenchmarkProgram().parseAsync(process.argv);
}
