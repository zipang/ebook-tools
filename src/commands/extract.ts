import { type ExtractRunResult, extractCommand } from "../extract/batch.ts";
import { AppError } from "../shared/errors.ts";

/** Options accepted by the extract command. */
export type ExtractOptions = {
	input?: string;
	document?: string;
	all?: boolean;
	force?: boolean;
};

/**
 * Run extraction and turn partial batch failures into a command error.
 *
 * The function returns a plain result. It writes nothing to the terminal,
 * so the command line and a Web UI report progress the same way.
 */
export const runExtract = async (
	options: ExtractOptions,
	repositoryRoot: string
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
