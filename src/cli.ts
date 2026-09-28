import { Command } from "commander";
import { runBuild } from "./commands/build.ts";
import { runDelete } from "./commands/delete.ts";
import { type ExtractOptions, runExtract } from "./commands/extract.ts";
import { runServe, type ServeOptions } from "./commands/serve.ts";
import { runTranslate, type TranslateCommandOptions } from "./commands/translate.ts";

export type { ExtractOptions, ServeOptions };

export type BuildOptions = {
	document: string;
	format: "html" | "pdf";
	out: string;
};

export type DeleteOptions = {
	document: string;
	parts: number[];
};

export type CliActions = {
	extract: (options: ExtractOptions) => Promise<void>;
	serve: (options: ServeOptions) => Promise<void>;
	build: (options: BuildOptions) => Promise<void>;
	delete: (options: DeleteOptions) => Promise<void>;
	translate: (options: TranslateCommandOptions) => Promise<void>;
};

/** Create the Commander program for the document pipeline. */
export const createProgram = (
	actions: CliActions = {
		extract: async (options) => {
			const result = await runExtract(options, process.cwd());
			for (const document of result.documents) {
				console.log(`Extracted ${document.manifest.title} into ${document.documentDir}`);
			}
			for (const skippedPath of result.skippedPaths) {
				console.warn(`Skipped unsupported source: ${skippedPath}`);
			}
		},
		serve: async (options) => {
			const result = await runServe(options, process.cwd());
			console.log(`Serving ${options.document} at ${result.url}`);
		},
		build: async (options) => {
			const result = await runBuild({
				repositoryRoot: process.cwd(),
				documentName: options.document,
				format: options.format,
				out: options.out
			});
			console.log(`Built ${options.document} into ${result.outputDir}`);

			for (const skipped of result.skippedImages) {
				console.warn(`Skipped image ${skipped.source} in ${skipped.unitPath}: ${skipped.reason}`);
			}
		},
		delete: async (options) => {
			const result = await runDelete({
				repositoryRoot: process.cwd(),
				documentName: options.document,
				parts: options.parts
			});
			console.log(
				`Deleted ${result.removedTitles.length} unit(s) from ${options.document}; ${result.remainingCount} remain.`
			);
		},
		translate: async (options) => {
			const result = await runTranslate(options, process.cwd());

			if (options.json) {
				console.log(JSON.stringify(result, null, 2));
			} else if (result.dryRun) {
				console.log(
					`Dry run: ${result.estimate?.units ?? 0} unit(s) to ${result.model} in ${options.to}; estimated cost $${result.costUsd.toFixed(4)}.`
				);
			} else {
				console.log(
					`Translated ${result.translated} unit(s), reused ${result.cached}, skipped ${result.skipped}, failed ${result.failed} in ${(result.wallClockMs / 1000).toFixed(1)}s into ${result.outputDir}.`
				);
				console.log(
					`Model ${result.model}, ${(result.durationMs / 1000).toFixed(1)}s, cost $${result.costUsd.toFixed(4)}.`
				);
			}

			if (result.failed > 0) {
				process.exitCode = 1;
			}
		}
	}
): Command => {
	const program = new Command();

	program.name("ebook-pipeline").description("Extract and render local books and documents.");

	program
		.command("extract")
		.description("Extract a PDF or EPUB into documents/")
		.option("--input <path>", "Source file to extract")
		.option("--document <name>", "Directory name for the extracted document")
		.option("--all", "Extract every supported file under sources/")
		.option("--force", "Replace an existing extracted document")
		.action(async (options: ExtractOptions) => {
			await actions.extract(options);
		});

	program
		.command("serve")
		.description("Serve one extracted document locally")
		.requiredOption("--document <name>", "Directory name under documents/")
		.option("--host <host>", "Host to bind", "127.0.0.1")
		.option("--port <port>", "Port to bind", "3000")
		.action(async (options: ServeOptions & { port: string }) => {
			await actions.serve({ ...options, port: Number(options.port) });
		});

	program
		.command("build")
		.description("Build HTML or PDF from an extracted document")
		.requiredOption("--document <name>", "Directory name under documents/")
		.requiredOption("--format <format>", "Output format: html or pdf")
		.option("--out <path>", "Output directory", "generated")
		.action(async (options: BuildOptions & { format: string }) => {
			if (options.format !== "html" && options.format !== "pdf") {
				throw new Error(`Unsupported build format: ${options.format}`);
			}

			await actions.build({ ...options, format: options.format });
		});

	program
		.command("delete")
		.description("Delete units from an extracted document and renumber the rest")
		.requiredOption("--document <name>", "Directory name under documents/")
		.requiredOption("--parts <parts...>", "Unit numbers to delete (1-based)")
		.action(async (options: { document: string; parts: string[] }) => {
			await actions.delete({
				document: options.document,
				parts: options.parts.map((part) => Number(part))
			});
		});

	program
		.command("translate")
		.description("Translate one extracted document into a target language")
		.requiredOption("--document <name>", "Directory name under documents/")
		.requiredOption("--to <lang>", "Target language tag, for example fr")
		.option("--model <id>", "Model identifier from the registry")
		.option("--out-document <name>", "Output project directory name")
		.option("--concurrency <n>", "Maximum parallel model calls", "4")
		.option("--only <parts...>", "Translate only these 1-based unit numbers")
		.option("--force", "Replace an existing translated project")
		.option("--dry-run", "Estimate the cost without calling a model")
		.option("--no-cache", "Ignore and do not write the per-unit cache")
		.option("--best-effort", "Copy failed units from the source instead of failing the run")
		.option("--max-cost <usd>", "Stop the run when this cost is reached")
		.option("--report <path>", "Write the Markdown report to this path")
		.option("--json", "Print a machine-readable summary")
		.action(
			async (options: {
				document: string;
				to: string;
				model?: string;
				outDocument?: string;
				concurrency: string;
				only?: string[];
				force?: boolean;
				dryRun?: boolean;
				cache?: boolean;
				bestEffort?: boolean;
				maxCost?: string;
				report?: string;
				json?: boolean;
			}) => {
				await actions.translate({
					document: options.document,
					to: options.to,
					model: options.model,
					outDocument: options.outDocument,
					concurrency: Number(options.concurrency),
					only: options.only?.map((part) => Number(part)),
					force: options.force ?? false,
					dryRun: options.dryRun,
					cache: options.cache ?? true,
					bestEffort: options.bestEffort ?? false,
					maxCost: options.maxCost === undefined ? undefined : Number(options.maxCost),
					report: options.report,
					json: options.json
				});
			}
		);

	return program;
};

/** Run the command-line program. */
export const runCli = async (): Promise<void> => {
	const program = createProgram();
	await program.parseAsync(process.argv);
};

if (import.meta.main) {
	await runCli();
}
