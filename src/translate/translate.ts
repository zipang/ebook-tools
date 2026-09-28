import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { generateText } from "ai";
import {
	type DocumentManifest,
	directionForLanguage,
	serializeManifest,
	validateManifest
} from "../model/project.ts";
import { readDocumentManifest } from "../services/document.ts";
import { AppError, ValidationError } from "../shared/errors.ts";
import { assertDocumentName, resolveDocumentRoot } from "../shared/paths.ts";
import { type CacheEntry, cacheKey, readCache, writeCache } from "./cache.ts";
import { buildSystemPrompt, buildUserPrompt, TRANSLATION_PROMPT_VERSION } from "./prompt.ts";
import { estimateCostUsd, findModel } from "./providers/registry.ts";
import { createZenModel, providerOptionsKeyFor } from "./providers/zen.ts";
import { renderTranslationJson, renderTranslationMarkdown } from "./report.ts";
import type {
	ModelEntry,
	ModelResult,
	ModelRunner,
	SourceProject,
	TokenUsage,
	TranslateJob,
	TranslateOptions,
	TranslateResult,
	UnitResult
} from "./types.ts";
import { extractFirstHeading, stripOuterCodeFence, validateTranslation } from "./validate.ts";

/** Number of parallel model calls when the caller gives no limit. */
export const DEFAULT_CONCURRENCY = 4;

/** Largest number of parallel model calls the pool accepts. */
export const MAX_CONCURRENCY = 16;
const CHARS_PER_TOKEN = 4;
const CACHE_FILE = "reports/translation.cache.json";
const PROJECT_DIRECTORIES = ["chapters", "assets", "templates", "reports", "generated"];

const emptyUsage = (): TokenUsage => ({ noCacheTokens: 0, cacheReadTokens: 0, outputTokens: 0 });

/** Normalize a BCP-47 language tag and return its lower-case form. */
export const normalizeLanguageTag = (tag: string): string => {
	const trimmed = tag.trim();

	if (!trimmed) {
		throw new ValidationError("--to must be a language tag such as fr or fr-CA");
	}

	let canonical: string | undefined;

	try {
		[canonical] = Intl.getCanonicalLocales(trimmed);
	} catch {
		throw new ValidationError(`Invalid language tag: ${tag}`);
	}

	if (!canonical) {
		throw new ValidationError(`Invalid language tag: ${tag}`);
	}

	return canonical.toLowerCase();
};

/** Derive the default output project name for a target language. */
export const defaultOutDocument = (document: string, language: string): string =>
	`${document}-${language.toLowerCase()}`;

/** Call a model and return its answer. */
export const createModelRunner = (env: Record<string, string | undefined> = process.env): ModelRunner => {
	return async (input) => {
		const model = createZenModel(input.entry, env);
		// The registry keeps provider options loosely typed. The AI SDK expects
		// JSON values, so the object is narrowed at this boundary.
		const providerOptions = input.entry.providerOptions
			? ({ [providerOptionsKeyFor(input.entry.protocol)]: input.entry.providerOptions } as Parameters<
					typeof generateText
				>[0]["providerOptions"])
			: undefined;
		const result = await generateText({
			model,
			system: input.system,
			prompt: input.user,
			maxOutputTokens: input.entry.maxOutputTokens,
			...(providerOptions ? { providerOptions } : {})
		});

		return {
			text: result.text,
			usage: {
				noCacheTokens: result.usage.inputTokenDetails?.noCacheTokens ?? result.usage.inputTokens ?? 0,
				cacheReadTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
				outputTokens: result.usage.outputTokens ?? 0
			},
			finishReason: result.finishReason
		};
	};
};

/** Return true when an error is worth retrying because no response was billed. */
export const isRetryableError = (error: unknown): boolean => {
	if (error instanceof TypeError) {
		return true;
	}

	const status = (error as { statusCode?: number } | null)?.statusCode;

	return status === 408 || status === 409 || status === 425 || status === 429 || Number(status) >= 500;
};

/** Call a function and retry retryable failures with exponential backoff. */
export const withRetry = async <T>(action: () => Promise<T>, attempts = 3): Promise<T> => {
	let lastError: unknown;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await action();
		} catch (error) {
			lastError = error;

			if (!isRetryableError(error) || attempt === attempts) {
				throw error;
			}

			await Bun.sleep(2 ** attempt * 100);
		}
	}

	throw lastError;
};

/** Load and validate a source document project. */
export const loadSourceProject = async (
	repositoryRoot: string,
	documentName: string
): Promise<SourceProject> => {
	const documentDir = resolveDocumentRoot(repositoryRoot, documentName);

	if (!(await Bun.file(join(documentDir, "manifest.json")).exists())) {
		throw new AppError("document-not-found", `Document not found under documents/: ${documentName}`);
	}

	return { documentDir, manifest: await readDocumentManifest(documentDir) };
};

/** Build the translation jobs of a document, keeping manifest order. */
export const buildJobs = async (source: SourceProject, only?: number[]): Promise<TranslateJob[]> => {
	const selected = only ? new Set(only) : undefined;
	const jobs: TranslateJob[] = [];

	for (const [index, unit] of source.manifest.units.entries()) {
		if (selected && !selected.has(index + 1)) {
			continue;
		}

		const file = Bun.file(join(source.documentDir, unit.path));

		if (!(await file.exists())) {
			throw new AppError("unit-not-found", `Missing unit file: ${unit.path}`);
		}

		jobs.push({
			unitId: unit.id,
			unitTitle: unit.title,
			unitPath: unit.path,
			markdown: await file.text(),
			unitIndex: index
		});
	}

	return jobs;
};

/** Run tasks with a bounded number of parallel workers, keeping input order. */
export const runPool = async <T, R>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
	const results = new Array<R>(items.length);
	let cursor = 0;

	const next = async (): Promise<void> => {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			results[index] = await worker(items[index] as T, index);
		}
	};

	const size = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: size }, () => next()));

	return results;
};

/**
 * Return true when a directory exists.
 *
 * `Bun.file(path).exists()` is not a directory check. It returns false for a
 * directory, so the stat call is what tells the two apart.
 */
const directoryExists = async (path: string): Promise<boolean> => {
	try {
		return (await Bun.file(path).stat()).isDirectory();
	} catch {
		return false;
	}
};

/** Return true when the output project already holds content. */
const hasContent = async (outputDir: string): Promise<boolean> => {
	const manifest = Bun.file(join(outputDir, "manifest.json"));

	return (await manifest.exists()) || (await directoryExists(join(outputDir, "chapters")));
};

/** Build a failed unit result. */
const failedResult = (job: TranslateJob, model: string, error: string): UnitResult => ({
	unitId: job.unitId,
	unitTitle: job.unitTitle,
	unitPath: job.unitPath,
	status: "failed",
	model,
	durationMs: 0,
	usage: emptyUsage(),
	costUsd: 0,
	error,
	warnings: []
});

/** Build a skipped unit result that keeps the source text. */
const skippedResult = (job: TranslateJob, model: string, reason: string): UnitResult => ({
	unitId: job.unitId,
	unitTitle: job.unitTitle,
	unitPath: job.unitPath,
	status: "skipped",
	model,
	durationMs: 0,
	usage: emptyUsage(),
	costUsd: 0,
	markdown: job.markdown,
	translatedTitle: job.unitTitle,
	warnings: [reason]
});

/** Build the translated manifest of the output project. */
const buildOutputManifest = (
	source: SourceProject,
	outputName: string,
	language: string,
	results: Map<string, UnitResult>,
	documentTitle: string
): DocumentManifest => {
	const units = source.manifest.units.map((unit) => {
		const result = results.get(unit.id);

		return { ...unit, title: result?.translatedTitle ?? unit.title };
	});

	const manifest: DocumentManifest = {
		...source.manifest,
		id: outputName,
		title: documentTitle,
		language,
		direction: directionForLanguage(language),
		units
	};

	return validateManifest(manifest);
};

/** Write the translated sibling project. */
const writeProject = async (
	source: SourceProject,
	outputDir: string,
	outputName: string,
	language: string,
	results: Map<string, UnitResult>,
	documentTitle: string
): Promise<void> => {
	if (await hasContent(outputDir)) {
		await rm(outputDir, { recursive: true, force: true });
	}

	for (const directory of PROJECT_DIRECTORIES) {
		await mkdir(join(outputDir, directory), { recursive: true });
	}

	const unitsById = new Map(source.manifest.units.map((unit) => [unit.id, unit]));

	for (const [unitId, result] of results) {
		const unit = unitsById.get(unitId);

		if (unit === undefined || result.markdown === undefined) {
			continue;
		}

		await Bun.write(join(outputDir, unit.path), result.markdown);
	}

	for (const directory of ["assets", "templates"]) {
		const from = join(source.documentDir, directory);

		if (await directoryExists(from)) {
			await cp(from, join(outputDir, directory), { recursive: true });
		}
	}

	const manifest = buildOutputManifest(source, outputName, language, results, documentTitle);
	await Bun.write(join(outputDir, "manifest.json"), serializeManifest(manifest));
};

/** Estimate a dry run without calling a model. */
export const estimateDryRun = async (
	options: Pick<TranslateOptions, "document" | "to" | "model" | "outDocument" | "only">,
	repositoryRoot: string
): Promise<{
	model: string;
	language: string;
	outDocument: string;
	units: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}> => {
	const entry = findModel(options.model);
	const language = normalizeLanguageTag(options.to);
	const outDocument = options.outDocument || defaultOutDocument(options.document, language);
	const source = await loadSourceProject(repositoryRoot, options.document);
	const jobs = await buildJobs(source, options.only);
	const systemChars = buildSystemPrompt({ to: language, from: source.manifest.language }).length;
	const bodyChars = jobs.reduce(
		(total, job) => total + job.markdown.length + job.unitTitle.length + 200,
		systemChars
	);
	const inputTokens = Math.ceil(bodyChars / CHARS_PER_TOKEN);
	const outputTokens = jobs.reduce(
		(total, job) => total + Math.ceil(job.markdown.length / CHARS_PER_TOKEN),
		0
	);
	const costUsd = estimateCostUsd(entry, { noCacheTokens: inputTokens, cacheReadTokens: 0, outputTokens });

	return { model: entry.id, language, outDocument, units: jobs.length, inputTokens, outputTokens, costUsd };
};

/** Translate one extracted document into a sibling project. */
export const translateDocument = async (
	options: TranslateOptions,
	repositoryRoot: string,
	deps: { runModel?: ModelRunner } = {}
): Promise<TranslateResult> => {
	const entry = findModel(options.model);
	const language = normalizeLanguageTag(options.to);
	const outputName = options.outDocument || defaultOutDocument(options.document, language);

	assertDocumentName(outputName);

	if (outputName === options.document) {
		throw new ValidationError("The output document must differ from the source document");
	}

	const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
		throw new ValidationError(`--concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
	}

	const source = await loadSourceProject(repositoryRoot, options.document);
	const outputDir = resolveDocumentRoot(repositoryRoot, outputName);
	const unitsById = new Map(source.manifest.units.map((unit) => [unit.id, unit]));

	if (!options.force && (await hasContent(outputDir))) {
		throw new ValidationError(
			`Output project documents/${outputName} already has content. Use --force to replace it.`
		);
	}

	const jobs = await buildJobs(source, options.only);
	const unitIds = new Set(source.manifest.units.map((unit) => unit.id));
	const cachePath = join(outputDir, CACHE_FILE);
	const cache = options.cache ? await readCache(cachePath) : {};
	const runModel = deps.runModel ?? createModelRunner();
	const system = buildSystemPrompt({ to: language, from: source.manifest.language });
	const nextCache: Record<string, CacheEntry> = { ...cache };
	let spent = 0;

	const runStartedAt = Date.now();
	const results = await runPool(jobs, concurrency, async (job): Promise<UnitResult> => {
		const key = cacheKey({
			model: entry.id,
			to: language,
			promptVersion: TRANSLATION_PROMPT_VERSION,
			markdown: job.markdown
		});
		const hit = options.cache ? cache[key] : undefined;

		if (hit) {
			return {
				unitId: job.unitId,
				unitTitle: job.unitTitle,
				unitPath: job.unitPath,
				status: "cached",
				model: entry.id,
				durationMs: 0,
				usage: hit.usage,
				costUsd: 0,
				markdown: hit.markdown,
				translatedTitle: hit.translatedTitle ?? job.unitTitle,
				warnings: []
			};
		}

		if (options.maxCostUsd !== undefined && spent >= options.maxCostUsd) {
			return skippedResult(job, entry.id, "Skipped because the cost limit was reached");
		}

		const startedAt = Date.now();
		let answer: ModelResult;

		try {
			answer = await withRetry(() =>
				runModel({
					entry,
					system,
					user: buildUserPrompt({
						title: job.unitTitle,
						markdown: job.markdown,
						to: language,
						from: source.manifest.language
					}),
					markdown: job.markdown
				})
			);
		} catch (error) {
			return failedResult(job, entry.id, `Model call failed: ${String(error)}`);
		}

		const durationMs = Date.now() - startedAt;
		const truncated = answer.finishReason === "length";

		if (truncated) {
			return {
				...failedResult(
					job,
					entry.id,
					`Model output was truncated at maxOutputTokens=${entry.maxOutputTokens}`
				),
				durationMs,
				usage: answer.usage,
				costUsd: estimateCostUsd(entry, answer.usage)
			};
		}

		const translated = stripOuterCodeFence(answer.text);
		const outcome = validateTranslation({
			sourceMarkdown: job.markdown,
			translatedMarkdown: translated,
			unitIds
		});

		if (!outcome.ok) {
			return {
				...failedResult(
					job,
					entry.id,
					`Structure check failed: ${outcome.issues.map((issue) => issue.message).join(" ")}`
				),
				durationMs,
				usage: answer.usage,
				costUsd: estimateCostUsd(entry, answer.usage),
				warnings: outcome.warnings
			};
		}

		const costUsd = estimateCostUsd(entry, answer.usage);
		spent += costUsd;

		if (options.cache) {
			nextCache[key] = {
				unitId: job.unitId,
				markdown: translated,
				translatedTitle: extractFirstHeading(translated) ?? job.unitTitle,
				usage: answer.usage,
				costUsd,
				durationMs,
				model: entry.id
			};
		}

		return {
			unitId: job.unitId,
			unitTitle: job.unitTitle,
			unitPath: job.unitPath,
			status: "translated",
			model: entry.id,
			durationMs,
			usage: answer.usage,
			costUsd,
			markdown: translated,
			translatedTitle: extractFirstHeading(translated) ?? job.unitTitle,
			warnings: outcome.warnings
		};
	});

	const ordered: UnitResult[] = [];
	const resultsByUnitId = new Map(results.map((result) => [result.unitId, result]));

	for (const unit of source.manifest.units) {
		const result = resultsByUnitId.get(unit.id);

		if (result !== undefined) {
			ordered.push(result);
			continue;
		}

		const markdown = await Bun.file(join(source.documentDir, unit.path)).text();
		ordered.push(
			skippedResult(
				{ unitId: unit.id, unitTitle: unit.title, unitPath: unit.path, markdown, unitIndex: 0 },
				entry.id,
				"Not selected"
			)
		);
	}

	const byUnit = new Map(ordered.map((result) => [result.unitId, result]));
	const failed = ordered.filter((result) => result.status === "failed");

	if (options.bestEffort) {
		for (const result of failed) {
			if (result.markdown !== undefined) {
				continue;
			}

			const unit = unitsById.get(result.unitId);

			if (unit !== undefined) {
				result.markdown = await Bun.file(join(source.documentDir, unit.path)).text();
				result.translatedTitle = unit.title;
			}
		}
	}

	// Write the cache before the failure return. A unit that translated
	// successfully was billed, so a retry must not pay for it twice.
	if (options.cache) {
		await writeCache(cachePath, nextCache, TRANSLATION_PROMPT_VERSION);
	}

	if (failed.length > 0 && !options.bestEffort) {
		const summary = summarize(
			outputDir,
			entry,
			ordered,
			TRANSLATION_PROMPT_VERSION,
			Date.now() - runStartedAt
		);
		await writeReports(summary, {
			source: { document: options.document, language: source.manifest.language },
			target: { document: outputName, language },
			outputDir,
			reportPath: options.reportPath
		});

		return summary;
	}

	const firstUnit = ordered[0];
	const firstTranslated = firstUnit?.status === "translated" || firstUnit?.status === "cached";
	const documentTitle = firstTranslated
		? (firstUnit?.translatedTitle ?? source.manifest.title)
		: source.manifest.title;

	await writeProject(source, outputDir, outputName, language, byUnit, documentTitle);

	const summary = summarize(
		outputDir,
		entry,
		ordered,
		TRANSLATION_PROMPT_VERSION,
		Date.now() - runStartedAt
	);
	await writeReports(summary, {
		source: { document: options.document, language: source.manifest.language },
		target: { document: outputName, language },
		outputDir,
		reportPath: options.reportPath
	});

	return summary;
};

/** Write the human and machine translation reports. */
const writeReports = async (
	summary: TranslateResult,
	context: {
		source: { document: string; language: string };
		target: { document: string; language: string };
		outputDir: string;
		reportPath?: string | undefined;
	}
): Promise<void> => {
	const input = {
		result: summary,
		source: context.source,
		target: context.target,
		generatedAt: new Date().toISOString()
	};
	const markdownPath = context.reportPath
		? isAbsolute(context.reportPath)
			? context.reportPath
			: join(context.outputDir, context.reportPath)
		: join(context.outputDir, "reports", "translation.md");

	await mkdir(dirname(markdownPath), { recursive: true });
	await Bun.write(markdownPath, renderTranslationMarkdown(input));
	await Bun.write(join(context.outputDir, "reports", "translation.json"), renderTranslationJson(input));
};

/** Build the run summary. */
const summarize = (
	outputDir: string,
	entry: ModelEntry,
	units: UnitResult[],
	promptVersion: string,
	wallClockMs: number
): TranslateResult => {
	const count = (status: UnitResult["status"]): number =>
		units.filter((unit) => unit.status === status).length;
	const sum = (pick: (unit: UnitResult) => number): number =>
		Number(units.reduce((total, unit) => total + pick(unit), 0).toFixed(6));

	return {
		outputDir,
		model: entry.id,
		promptVersion,
		translated: count("translated"),
		cached: count("cached"),
		failed: count("failed"),
		skipped: count("skipped"),
		inputTokens: sum((unit) => unit.usage.noCacheTokens + unit.usage.cacheReadTokens),
		outputTokens: sum((unit) => unit.usage.outputTokens),
		durationMs: sum((unit) => unit.durationMs),
		wallClockMs,
		costUsd: sum((unit) => unit.costUsd),
		units
	};
};
