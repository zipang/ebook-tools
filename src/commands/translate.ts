import { ValidationError } from "../shared/errors.ts";
import { DEFAULT_MODEL_ID } from "../translate/providers/registry.ts";
import {
	defaultOutDocument,
	estimateDryRun,
	normalizeLanguageTag,
	translateDocument
} from "../translate/translate.ts";
import type { ModelRunner, TranslateResult } from "../translate/types.ts";

/** Options accepted by the translate command. */
export type TranslateCommandOptions = {
	document: string;
	to: string;
	model?: string | undefined;
	outDocument?: string | undefined;
	concurrency?: number | undefined;
	only?: number[] | undefined;
	force: boolean;
	dryRun?: boolean | undefined;
	cache: boolean;
	bestEffort: boolean;
	maxCost?: number | undefined;
	report?: string | undefined;
	json?: boolean | undefined;
};

/** Result of the translate command. */
export type TranslateCommandResult = {
	outputDir: string;
	model: string;
	units: number;
	translated: number;
	cached: number;
	failed: number;
	skipped: number;
	costUsd: number;
	durationMs: number;
	wallClockMs: number;
	dryRun: boolean;
	estimate?: {
		units: number;
		inputTokens: number;
		outputTokens: number;
		costUsd: number;
	};
};

/** Parse a non-negative number option, such as a USD cost. */
const parseNumber = (value: number | string | undefined, name: string): number | undefined => {
	if (value === undefined) {
		return undefined;
	}

	const parsed = typeof value === "number" ? value : Number(value);

	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new ValidationError(`${name} must be a non-negative number`);
	}

	return parsed;
};

/** Validate the selected unit numbers. */
const parseUnits = (units: number[] | undefined, total: number): number[] | undefined => {
	if (!units) {
		return undefined;
	}

	for (const unit of units) {
		if (!Number.isInteger(unit) || unit < 1 || unit > total) {
			throw new ValidationError(`--only must contain unit numbers between 1 and ${total}`);
		}
	}

	return [...new Set(units)];
};

/** Validate and run a translate command. */
export const runTranslate = async (
	options: TranslateCommandOptions,
	repositoryRoot: string,
	deps: { runModel?: ModelRunner } = {}
): Promise<TranslateCommandResult> => {
	const model = options.model ?? DEFAULT_MODEL_ID;
	const language = normalizeLanguageTag(options.to);
	const outDocument = options.outDocument || defaultOutDocument(options.document, language);

	if (options.dryRun) {
		const estimate = await estimateDryRun(
			{ document: options.document, to: options.to, model, outDocument, only: options.only },
			repositoryRoot
		);

		return {
			outputDir: "",
			model: estimate.model,
			units: estimate.units,
			translated: 0,
			cached: 0,
			failed: 0,
			skipped: 0,
			costUsd: estimate.costUsd,
			durationMs: 0,
			wallClockMs: 0,
			dryRun: true,
			estimate
		};
	}

	const totalUnits = await countUnits(repositoryRoot, options.document);
	const only = parseUnits(options.only, totalUnits);
	const maxCostUsd = parseNumber(options.maxCost, "--max-cost");

	if (maxCostUsd === 0) {
		throw new ValidationError("--max-cost must be greater than 0");
	}

	const result: TranslateResult = await translateDocument(
		{
			document: options.document,
			to: language,
			model,
			outDocument,
			concurrency: options.concurrency ?? 4,
			only,
			force: options.force,
			cache: options.cache,
			bestEffort: options.bestEffort,
			maxCostUsd,
			reportPath: options.report
		},
		repositoryRoot,
		deps
	);

	return {
		outputDir: result.outputDir,
		model: result.model,
		units: result.units.length,
		translated: result.translated,
		cached: result.cached,
		failed: result.failed,
		skipped: result.skipped,
		costUsd: result.costUsd,
		durationMs: result.durationMs,
		wallClockMs: result.wallClockMs,
		dryRun: false
	};
};

/** Count the units of a source document. */
const countUnits = async (repositoryRoot: string, documentName: string): Promise<number> => {
	const manifestFile = Bun.file(`${repositoryRoot}/documents/${documentName}/manifest.json`);

	if (!(await manifestFile.exists())) {
		return Number.POSITIVE_INFINITY;
	}

	const manifest = (await manifestFile.json()) as { units?: unknown };

	return Array.isArray(manifest.units) ? manifest.units.length : Number.POSITIVE_INFINITY;
};
