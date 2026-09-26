import type { DocumentManifest } from "../model/project.ts";

/** Protocol used to reach a model on the OpenCode Zen gateway. */
export type ModelProtocol = "openai-compatible" | "google" | "openai" | "anthropic";

/** Price of one million tokens in US dollars. */
export type ModelPricing = {
	input: number;
	output: number;
	cachedRead?: number;
};

/** One model available for translation. */
export type ModelEntry = {
	/** Logical identifier used by the `--model` option. */
	id: string;
	/** Model identifier sent to the gateway. */
	zenModel: string;
	protocol: ModelProtocol;
	label: string;
	/** Price in US dollars per one million tokens. */
	pricing: ModelPricing;
	contextWindow: number;
	/**
	 * Output token cap for one call. The Anthropic protocol requires it, and
	 * some gateways default to a low value when they do not know the model.
	 */
	maxOutputTokens: number;
	/**
	 * Provider options merged under the provider namespace and sent with every
	 * call. Reasoning models use them to bound or disable their thinking so
	 * they do not spend the whole output budget before writing any text.
	 */
	providerOptions?: Record<string, unknown>;
};

/** Token counts used for cost accounting. */
export type TokenUsage = {
	noCacheTokens: number;
	cacheReadTokens: number;
	outputTokens: number;
};

/** Answer returned by a model call. */
export type ModelResult = {
	text: string;
	usage: TokenUsage;
	/** Unified finish reason, for example "stop" or "length". */
	finishReason?: string;
};

/** Input handed to a model call. */
export type ModelCallInput = {
	entry: ModelEntry;
	system: string;
	user: string;
	markdown: string;
};

/** Function that calls a model and returns its answer. */
export type ModelRunner = (input: ModelCallInput) => Promise<ModelResult>;

/** One unit of translation work. */
export type TranslateJob = {
	unitId: string;
	unitTitle: string;
	unitPath: string;
	markdown: string;
	unitIndex: number;
};

/** Outcome of one unit. */
export type UnitStatus = "translated" | "cached" | "failed" | "skipped";

/** Result of one unit. */
export type UnitResult = {
	unitId: string;
	unitTitle: string;
	unitPath: string;
	status: UnitStatus;
	model: string;
	durationMs: number;
	usage: TokenUsage;
	costUsd: number;
	markdown?: string;
	translatedTitle?: string;
	error?: string;
	warnings: string[];
};

/** One structural problem found in a model response. */
export type ValidationIssue = {
	kind: "structure" | "link" | "image" | "internal-link";
	message: string;
};

/** Outcome of the structural comparison between source and translation. */
export type ValidationOutcome = {
	ok: boolean;
	issues: ValidationIssue[];
	warnings: string[];
};

/** Options accepted by the translation orchestration. */
export type TranslateOptions = {
	document: string;
	to: string;
	model: string;
	outDocument: string;
	concurrency: number;
	only?: number[] | undefined;
	force: boolean;
	cache: boolean;
	bestEffort: boolean;
	maxCostUsd?: number | undefined;
	reportPath?: string | undefined;
};

/** Summary of a whole run. */
export type TranslateResult = {
	outputDir: string;
	model: string;
	promptVersion: string;
	translated: number;
	cached: number;
	failed: number;
	skipped: number;
	inputTokens: number;
	outputTokens: number;
	/** Sum of the per-unit times. Equals the wall clock only at concurrency 1. */
	durationMs: number;
	/** Real elapsed time of the run, which reflects the parallelism. */
	wallClockMs: number;
	costUsd: number;
	units: UnitResult[];
};

/** The source project loaded for translation. */
export type SourceProject = {
	manifest: DocumentManifest;
	documentDir: string;
};
