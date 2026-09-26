import { describe, expect, test } from "bun:test";
import { renderTranslationJson, renderTranslationMarkdown } from "../../src/translate/report.ts";
import type { TranslateResult, UnitResult } from "../../src/translate/types.ts";

const unit = (overrides: Partial<UnitResult>): UnitResult => ({
	unitId: "unit-001",
	unitTitle: "Alpha",
	unitPath: "chapters/001-alpha.md",
	status: "translated",
	model: "deepseek-v4.1-flash",
	durationMs: 400,
	usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 },
	costUsd: 0.001,
	warnings: [],
	...overrides
});

const result: TranslateResult = {
	outputDir: "/tmp/documents/book-fr",
	model: "deepseek-v4.1-flash",
	promptVersion: "t0002-v1",
	translated: 1,
	cached: 1,
	failed: 1,
	skipped: 0,
	inputTokens: 300,
	outputTokens: 60,
	durationMs: 1200,
	wallClockMs: 400,
	costUsd: 0.0123,
	units: [
		unit({}),
		unit({ unitId: "unit-002", unitTitle: "Beta", status: "cached", durationMs: 0, costUsd: 0 }),
		unit({
			unitId: "unit-003",
			unitTitle: "Gamma",
			status: "failed",
			durationMs: 250,
			error: "Structure check failed: Block 1 changed.",
			warnings: ["Translated length ratio is 3.10 and leaves the band 0.4 to 2.5."]
		})
	]
};

const input = {
	result,
	source: { document: "book", language: "en" },
	target: { document: "book-fr", language: "fr" },
	generatedAt: "2026-09-26T10:00:00.000Z"
};

describe("renderTranslationMarkdown", () => {
	test("names the source, the target, the model, and the prompt version", () => {
		const markdown = renderTranslationMarkdown(input);

		expect(markdown).toContain("# Translation report");
		expect(markdown).toContain("`book`");
		expect(markdown).toContain("`book-fr`");
		expect(markdown).toContain("`fr`");
		expect(markdown).toContain("`deepseek-v4.1-flash`");
		expect(markdown).toContain("`t0002-v1`");
	});

	test("lists the counters and the totals", () => {
		const markdown = renderTranslationMarkdown(input);

		expect(markdown).toContain("| Units | 3 |");
		expect(markdown).toContain("| Translated | 1 |");
		expect(markdown).toContain("| Cached | 1 |");
		expect(markdown).toContain("| Failed | 1 |");
		expect(markdown).toContain("| Skipped | 0 |");
		expect(markdown).toContain("| Input tokens | 300 |");
		expect(markdown).toContain("| Output tokens | 60 |");
		expect(markdown).toContain("| Cost (USD) | 0.0123 |");
	});

	test("tabulates every unit in source order", () => {
		const markdown = renderTranslationMarkdown(input);
		const rows = markdown.split("\n").filter((line) => line.startsWith("| `unit-"));

		expect(rows).toHaveLength(3);
		expect(rows[0]).toContain("Alpha");
		expect(rows[1]).toContain("Beta");
		expect(rows[2]).toContain("Gamma");
	});

	test("groups the warnings by unit", () => {
		const markdown = renderTranslationMarkdown(input);

		expect(markdown).toContain("## Warnings");
		expect(markdown).toContain("`unit-003`: Translated length ratio is 3.10");
	});

	test("lists the failures with their error", () => {
		const markdown = renderTranslationMarkdown(input);

		expect(markdown).toContain("## Failures");
		expect(markdown).toContain("`unit-003`: Structure check failed: Block 1 changed.");
	});

	test("omits the warnings and failures sections when there are none", () => {
		const clean = renderTranslationMarkdown({
			...input,
			result: { ...result, failed: 0, units: [unit({})] }
		});

		expect(clean).not.toContain("## Warnings");
		expect(clean).not.toContain("## Failures");
	});
});

describe("renderTranslationJson", () => {
	test("is valid JSON with the run metadata", () => {
		const parsed = JSON.parse(renderTranslationJson(input));

		expect(parsed.promptVersion).toBe("t0002-v1");
		expect(parsed.model).toBe("deepseek-v4.1-flash");
		expect(parsed.source).toEqual({ document: "book", language: "en" });
		expect(parsed.target).toEqual({ document: "book-fr", language: "fr" });
	});

	test("records the totals", () => {
		const parsed = JSON.parse(renderTranslationJson(input));

		expect(parsed.totals).toEqual({
			units: 3,
			translated: 1,
			cached: 1,
			failed: 1,
			skipped: 0,
			inputTokens: 300,
			outputTokens: 60,
			durationMs: 1200,
			wallClockMs: 400,
			costUsd: 0.0123
		});
	});

	test("records every unit with its usage and cost", () => {
		const parsed = JSON.parse(renderTranslationJson(input));

		expect(parsed.units).toHaveLength(3);
		expect(parsed.units[0]).toMatchObject({
			unitId: "unit-001",
			status: "translated",
			cached: false,
			usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 },
			costUsd: 0.001
		});
		expect(parsed.units[1].cached).toBe(true);
	});

	test("records the failures separately", () => {
		const parsed = JSON.parse(renderTranslationJson(input));

		expect(parsed.failures).toEqual([
			{ unitId: "unit-003", unitTitle: "Gamma", error: "Structure check failed: Block 1 changed." }
		]);
	});

	test("never contains a credential", () => {
		expect(renderTranslationJson(input)).not.toContain("OPENCODE_API_KEY");
	});
});
