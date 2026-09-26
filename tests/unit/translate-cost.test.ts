import { describe, expect, test } from "bun:test";
import { estimateCostUsd, findModel, listModels } from "../../src/translate/providers/registry.ts";

describe("estimateCostUsd for the candidate models", () => {
	test("prices a one-million-token round trip for the budget candidates", () => {
		const rows = [
			{ id: "gpt-6-luna", expected: 0.1 + 0.5 },
			{ id: "deepseek-v4-flash", expected: 0.14 + 0.28 },
			{ id: "glm-5.3-flash", expected: 0.15 + 0.5 },
			{ id: "gpt-5.6-luna", expected: 0.2 + 1.2 },
			{ id: "deepseek-v4.1-flash", expected: 0.3 + 1.2 },
			{ id: "minimax-m3", expected: 0.3 + 1.2 },
			{ id: "gemini-3.5-flash-lite", expected: 0.3 + 2.5 },
			{ id: "gemini-3-flash", expected: 0.5 + 3 },
			{ id: "glm-5.3", expected: 1.4 + 4.4 }
		];

		for (const row of rows) {
			const cost = estimateCostUsd(findModel(row.id), {
				noCacheTokens: 1_000_000,
				cacheReadTokens: 0,
				outputTokens: 1_000_000
			});

			expect(cost).toBeCloseTo(row.expected, 6);
		}
	});

	test("keeps the budget candidates cheaper than the premium candidate", () => {
		const usage = { noCacheTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 1_000_000 };
		const premium = estimateCostUsd(findModel("glm-5.3"), usage);

		for (const id of ["gpt-6-luna", "deepseek-v4-flash", "glm-5.3-flash"]) {
			expect(estimateCostUsd(findModel(id), usage)).toBeLessThan(premium);
		}
	});

	test("orders the registry by rising input price", () => {
		const prices = listModels().map((entry) => entry.pricing.input);

		expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
	});
});
