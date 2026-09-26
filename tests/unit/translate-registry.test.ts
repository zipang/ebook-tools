import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/shared/errors.ts";
import {
	DEFAULT_MODEL_ID,
	estimateCostUsd,
	findModel,
	listModels,
	MODEL_REGISTRY
} from "../../src/translate/providers/registry.ts";

describe("model registry", () => {
	test("exposes the candidate models in rising price order", () => {
		expect(listModels().map((entry) => entry.id)).toEqual([
			"gpt-6-luna",
			"deepseek-v4-flash",
			"glm-5.3-flash",
			"gpt-5.6-luna",
			"deepseek-v4.1-flash",
			"minimax-m3",
			"gemini-3.5-flash-lite",
			"gemini-3-flash",
			"glm-5.3"
		]);
	});

	test("declares the protocol and the price of every candidate", () => {
		for (const entry of MODEL_REGISTRY) {
			expect(["openai-compatible", "openai", "google"]).toContain(entry.protocol);
			expect(entry.maxOutputTokens).toBeGreaterThanOrEqual(8192);
			expect(entry.pricing.input).toBeGreaterThanOrEqual(0);
			expect(entry.pricing.output).toBeGreaterThan(0);
			expect(entry.contextWindow).toBeGreaterThan(0);
		}
	});

	test("resolves a known model id", () => {
		expect(findModel("deepseek-v4-flash")?.zenModel).toBe("deepseek-v4-flash");
		expect(findModel("gemini-3-flash")?.protocol).toBe("google");
	});

	test("rejects an unknown model id", () => {
		expect(() => findModel("gpt-9-ultra")).toThrow(ValidationError);
		expect(() => findModel("gpt-9-ultra")).toThrow("Unknown model id: gpt-9-ultra");
	});

	test("keeps the default model inside the registry", () => {
		expect(findModel(DEFAULT_MODEL_ID)).toBeDefined();
	});
});

describe("estimateCostUsd", () => {
	test("charges input and output tokens with the model price", () => {
		const entry = findModel("deepseek-v4-flash");

		const cost = estimateCostUsd(entry ?? undefined, {
			noCacheTokens: 1_000_000,
			cacheReadTokens: 0,
			outputTokens: 1_000_000
		});

		expect(cost).toBeCloseTo(0.14 + 0.28, 10);
	});

	test("uses the cached read price for cached tokens", () => {
		const entry = findModel("deepseek-v4.1-flash");

		const cost = estimateCostUsd(entry ?? undefined, {
			noCacheTokens: 0,
			cacheReadTokens: 1_000_000,
			outputTokens: 0
		});

		expect(cost).toBeCloseTo(entry?.pricing.cachedRead ?? 0, 10);
	});

	test("rounds to six decimals", () => {
		const entry = findModel("gemini-3-flash");

		const cost = estimateCostUsd(entry ?? undefined, {
			noCacheTokens: 1,
			cacheReadTokens: 0,
			outputTokens: 1
		});

		expect(cost).toBe(0.000004);
	});

	test("rejects a missing model entry", () => {
		expect(() =>
			estimateCostUsd(undefined, { noCacheTokens: 1, cacheReadTokens: 0, outputTokens: 1 })
		).toThrow(ValidationError);
	});
});
