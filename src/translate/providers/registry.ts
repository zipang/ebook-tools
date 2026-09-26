import { ValidationError } from "../../shared/errors.ts";
import type { ModelEntry, TokenUsage } from "../types.ts";

/**
 * Registry of models available for translation through the OpenCode Zen
 * gateway. Prices are US dollars per one million tokens, taken from the Zen
 * catalog when this ticket was written.
 */
export const MODEL_REGISTRY: ModelEntry[] = [
	{
		id: "gpt-6-luna",
		zenModel: "gpt-6-luna",
		protocol: "openai",
		label: "GPT 6 Luna",
		pricing: { input: 0.1, output: 0.5, cachedRead: 0.01 },
		contextWindow: 272_000,
		maxOutputTokens: 16384
	},
	{
		id: "deepseek-v4-flash",
		zenModel: "deepseek-v4-flash",
		protocol: "openai-compatible",
		label: "DeepSeek V4 Flash",
		pricing: { input: 0.14, output: 0.28, cachedRead: 0.028 },
		contextWindow: 128_000,
		maxOutputTokens: 16384
	},
	{
		id: "glm-5.3-flash",
		zenModel: "glm-5.3-flash",
		protocol: "openai-compatible",
		label: "GLM 5.3 Flash",
		pricing: { input: 0.15, output: 0.5, cachedRead: 0.03 },
		contextWindow: 128_000,
		maxOutputTokens: 16384,
		// Thinking-only model: "disabled" is rejected, but the lowest effort
		// keeps reasoning tokens from consuming the whole output budget.
		providerOptions: { reasoningEffort: "low" }
	},
	{
		id: "gpt-5.6-luna",
		zenModel: "gpt-5.6-luna",
		protocol: "openai",
		label: "GPT 5.6 Luna",
		pricing: { input: 0.2, output: 1.2, cachedRead: 0.02 },
		contextWindow: 272_000,
		maxOutputTokens: 16384
	},
	{
		id: "deepseek-v4.1-flash",
		zenModel: "deepseek-v4.1-flash",
		protocol: "openai-compatible",
		label: "DeepSeek V4.1 Flash",
		pricing: { input: 0.3, output: 1.2, cachedRead: 0.006 },
		contextWindow: 128_000,
		maxOutputTokens: 16384,
		// Thinking-only upstream: without this the model spends the whole output
		// budget on hidden reasoning and returns no text.
		providerOptions: { thinking: { type: "disabled" } }
	},
	{
		id: "minimax-m3",
		zenModel: "minimax-m3",
		protocol: "openai-compatible",
		label: "MiniMax M3",
		pricing: { input: 0.3, output: 1.2, cachedRead: 0.06 },
		contextWindow: 128_000,
		maxOutputTokens: 16384
	},
	{
		id: "gemini-3.5-flash-lite",
		zenModel: "gemini-3.5-flash-lite",
		protocol: "google",
		label: "Gemini 3.5 Flash Lite",
		pricing: { input: 0.3, output: 2.5, cachedRead: 0.03 },
		contextWindow: 1_000_000,
		maxOutputTokens: 16384
	},
	{
		id: "gemini-3-flash",
		zenModel: "gemini-3-flash",
		protocol: "google",
		label: "Gemini 3 Flash",
		pricing: { input: 0.5, output: 3, cachedRead: 0.05 },
		contextWindow: 1_000_000,
		maxOutputTokens: 16384
	},
	{
		id: "glm-5.3",
		zenModel: "glm-5.3",
		protocol: "openai-compatible",
		label: "GLM 5.3",
		pricing: { input: 1.4, output: 4.4, cachedRead: 0.26 },
		contextWindow: 128_000,
		maxOutputTokens: 16384,
		providerOptions: { reasoningEffort: "low" }
	}
];

/** Model used when the caller does not pass `--model`. */
export const DEFAULT_MODEL_ID = "gpt-6-luna";

/** List every model available for translation. */
export const listModels = (): ModelEntry[] => MODEL_REGISTRY;

/** Find a model by its logical identifier. */
export const findModel = (id: string): ModelEntry => {
	const entry = MODEL_REGISTRY.find((candidate) => candidate.id === id);

	if (!entry) {
		const known = MODEL_REGISTRY.map((candidate) => candidate.id).join(", ");
		throw new ValidationError(`Unknown model id: ${id}. Known model ids: ${known}`);
	}

	return entry;
};

/** Estimate the run cost from token usage and the model price. */
export const estimateCostUsd = (entry: ModelEntry | undefined, usage: TokenUsage): number => {
	if (!entry) {
		throw new ValidationError("Cannot estimate cost without a model entry");
	}

	const cachedReadPrice = entry.pricing.cachedRead ?? entry.pricing.input;
	const costUsd =
		(usage.noCacheTokens * entry.pricing.input +
			usage.cacheReadTokens * cachedReadPrice +
			usage.outputTokens * entry.pricing.output) /
		1_000_000;

	return Math.round(costUsd * 1e6) / 1e6;
};
