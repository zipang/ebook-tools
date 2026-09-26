import type { TranslateResult, UnitResult } from "./types.ts";

/** Everything a translation report needs. */
export type ReportInput = {
	result: TranslateResult;
	source: { document: string; language: string };
	target: { document: string; language: string };
	generatedAt: string;
};

/** Format a cost for a Markdown table. */
const usd = (value: number): string => value.toFixed(4);

/** Format a duration in seconds. */
const seconds = (value: number): string => (value / 1000).toFixed(2);

/** Render the human-readable translation report. */
export const renderTranslationMarkdown = (input: ReportInput): string => {
	const { result, source, target, generatedAt } = input;
	const lines: string[] = [
		"# Translation report",
		"",
		`- Source: \`${source.document}\` (\`${source.language}\`)`,
		`- Target: \`${target.document}\` (\`${target.language}\`)`,
		`- Model: \`${result.model}\``,
		`- Prompt version: \`${result.promptVersion}\``,
		`- Generated: ${generatedAt}`,
		"",
		"## Summary",
		"",
		"| Metric | Value |",
		"| --- | --- |",
		`| Units | ${result.units.length} |`,
		`| Translated | ${result.translated} |`,
		`| Cached | ${result.cached} |`,
		`| Failed | ${result.failed} |`,
		`| Skipped | ${result.skipped} |`,
		`| Input tokens | ${result.inputTokens} |`,
		`| Output tokens | ${result.outputTokens} |`,
		`| Wall clock (s) | ${seconds(result.wallClockMs)} |`,
		`| Unit time (s) | ${seconds(result.durationMs)} |`,
		`| Cost (USD) | ${usd(result.costUsd)} |`,
		"",
		"## Units",
		"",
		"| Unit | Title | Status | Model | Duration (s) | Input tok | Output tok | Cost (USD) |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |"
	];

	for (const unit of result.units) {
		lines.push(
			`| \`${unit.unitId}\` | ${unit.unitTitle} | ${unit.status} | \`${unit.model}\` | ${seconds(
				unit.durationMs
			)} | ${unit.usage.noCacheTokens + unit.usage.cacheReadTokens} | ${unit.usage.outputTokens} | ${usd(
				unit.costUsd
			)} |`
		);
	}

	const warned = result.units.filter((unit) => unit.warnings.length > 0);

	if (warned.length > 0) {
		lines.push("", "## Warnings", "");

		for (const unit of warned) {
			for (const warning of unit.warnings) {
				lines.push(`- \`${unit.unitId}\`: ${warning}`);
			}
		}
	}

	const failures = result.units.filter((unit) => unit.status === "failed");

	if (failures.length > 0) {
		lines.push("", "## Failures", "");

		for (const unit of failures) {
			lines.push(`- \`${unit.unitId}\`: ${unit.error ?? "Unknown error"}`);
		}
	}

	return `${lines.join("\n")}\n`;
};

/** Render the machine-readable translation report. */
export const renderTranslationJson = (input: ReportInput): string => {
	const { result, source, target, generatedAt } = input;
	const payload = {
		promptVersion: result.promptVersion,
		generatedAt,
		model: result.model,
		source,
		target,
		totals: {
			units: result.units.length,
			translated: result.translated,
			cached: result.cached,
			failed: result.failed,
			skipped: result.skipped,
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			durationMs: result.durationMs,
			wallClockMs: result.wallClockMs,
			costUsd: result.costUsd
		},
		units: result.units.map((unit: UnitResult) => ({
			unitId: unit.unitId,
			unitTitle: unit.unitTitle,
			unitPath: unit.unitPath,
			status: unit.status,
			cached: unit.status === "cached",
			model: unit.model,
			durationMs: unit.durationMs,
			usage: unit.usage,
			costUsd: unit.costUsd,
			warnings: unit.warnings
		})),
		failures: result.units
			.filter((unit) => unit.status === "failed")
			.map((unit) => ({ unitId: unit.unitId, unitTitle: unit.unitTitle, error: unit.error ?? null }))
	};

	return `${JSON.stringify(payload, null, 2)}\n`;
};
