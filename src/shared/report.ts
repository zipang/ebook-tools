import type { ExtractedDocument, ExtractionWarning, SourceMetadata } from "../model/document.ts";

export type ExtractionReport = {
	source: SourceMetadata;
	unitCount: number;
	imageCount: number;
	warnings: ExtractionWarning[];
};

/** Describe the source location of an extraction warning. */
const formatLocation = (warning: ExtractionWarning): string => {
	if (warning.location?.page !== undefined) {
		return `page ${warning.location.page}`;
	}
	if (warning.location?.spineIndex !== undefined) {
		return `spine item ${warning.location.spineIndex + 1}`;
	}
	return warning.location?.selector ?? "source";
};

/** Create a stable report from an extracted document. */
export const createExtractionReport = (document: ExtractedDocument): ExtractionReport => {
	return {
		source: document.source,
		unitCount: document.units.length,
		imageCount: document.assets.length,
		warnings: document.warnings
	};
};

/** Render an extraction report as Markdown. */
export const renderExtractionReport = (report: ExtractionReport): string => {
	const lines = [
		"# Extraction report",
		"",
		`- Source: \`${report.source.path}\``,
		`- Format: \`${report.source.format}\``,
		`- Size: ${report.source.size} bytes`,
		`- Markdown units: ${report.unitCount}`,
		`- Images: ${report.imageCount}`,
		`- Warnings: ${report.warnings.length}`,
		""
	];

	if (report.warnings.length === 0) {
		lines.push("No extraction warnings were recorded.");
		return `${lines.join("\n")}\n`;
	}

	lines.push("## Warnings", "");
	for (const warning of report.warnings) {
		lines.push(`- **${warning.code}** at ${formatLocation(warning)}: ${warning.message}`);
	}
	return `${lines.join("\n")}\n`;
};

/** Serialize an extraction report for machine consumers. */
export const serializeExtractionReport = (report: ExtractionReport): string => {
	return `${JSON.stringify(report, null, 2)}\n`;
};
