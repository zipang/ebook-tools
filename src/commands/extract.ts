import { type ExtractRunResult, extractCommand } from "../extract/batch.ts";
import { AppError } from "../shared/errors.ts";

/** Run extraction and turn partial batch failures into a command error. */
export const runExtract = async (
	options: { input?: string; document?: string; all?: boolean; force?: boolean },
	repositoryRoot = process.cwd()
): Promise<ExtractRunResult> => {
	const result = await extractCommand(options, repositoryRoot);
	if (result.failures.length > 0) {
		const details = result.failures
			.map((failure) => `${failure.sourcePath}: ${failure.message}`)
			.join("; ");
		throw new AppError(
			"batch-failed",
			`Extraction failed for ${result.failures.length} source(s): ${details}`
		);
	}
	return result;
};
