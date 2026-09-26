import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AppError, ValidationError } from "../../shared/errors.ts";
import type { ModelEntry, ModelProtocol } from "../types.ts";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";

/** Resolve the gateway credentials from the environment. */
export const readZenCredentials = (
	env: Record<string, string | undefined> = process.env
): { apiKey: string; baseURL: string } => {
	const apiKey = env.OPENCODE_API_KEY?.trim();

	if (!apiKey) {
		throw new AppError(
			"missing-api-key",
			"Missing OPENCODE_API_KEY. Export the OpenCode Zen key before running a translation."
		);
	}

	return { apiKey, baseURL: env.OPENCODE_ZEN_BASE_URL?.trim() || DEFAULT_BASE_URL };
};

/** Return the gateway base URL without requiring an API key. */
export const readZenBaseUrl = (env: Record<string, string | undefined> = process.env): string =>
	env.OPENCODE_ZEN_BASE_URL?.trim() || DEFAULT_BASE_URL;

/** Return the `providerOptions` namespace used by a protocol. */
export const providerOptionsKeyFor = (protocol: ModelProtocol): string =>
	protocol === "openai-compatible" ? "opencodeZen" : protocol;

/**
 * Build the AI SDK language model for a registry entry. Each Zen model family
 * speaks its own API and uses its own authentication header, so the protocol
 * decides which provider factory is used:
 *
 * - `openai-compatible` uses `Authorization: Bearer` on `/chat/completions`
 *   (DeepSeek, GLM, Kimi, MiniMax).
 * - `openai` uses `Authorization: Bearer` on `/responses` (GPT).
 * - `google` uses `x-goog-api-key` on `/models/<id>:generateContent` (Gemini).
 */
export const createZenModel = (entry: ModelEntry, env: Record<string, string | undefined> = process.env) => {
	const { apiKey, baseURL } = readZenCredentials(env);

	if (entry.protocol === "openai-compatible") {
		return createOpenAICompatible({ name: "opencode-zen", apiKey, baseURL })(entry.zenModel);
	}

	if (entry.protocol === "openai") {
		return createOpenAI({ apiKey, baseURL }).responses(entry.zenModel);
	}

	if (entry.protocol === "google") {
		return createGoogleGenerativeAI({ apiKey, baseURL })(entry.zenModel);
	}

	throw new ValidationError(`Unsupported model protocol: ${entry.protocol}`);
};
