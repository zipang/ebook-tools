import { Command } from "commander";
import { runBuild } from "./commands/build.ts";
import { runDelete } from "./commands/delete.ts";
import { runExtract } from "./commands/extract.ts";
import { runServe } from "./commands/serve.ts";

export type ExtractOptions = {
	input?: string;
	document?: string;
	all?: boolean;
	force?: boolean;
};

export type ServeOptions = {
	document: string;
	host?: string;
	port?: number;
};

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
};

/** Create the Commander program for the document pipeline. */
export const createProgram = (
	actions: CliActions = {
		extract: async (options) => {
			const result = await runExtract(options);
			for (const document of result.documents) {
				console.log(`Extracted ${document.manifest.title} into ${document.documentDir}`);
			}
			for (const skippedPath of result.skippedPaths) {
				console.warn(`Skipped unsupported source: ${skippedPath}`);
			}
		},
		serve: async (options) => {
			await runServe(options);
		},
		build: async (options) => {
			const result = await runBuild({
				repositoryRoot: process.cwd(),
				documentName: options.document,
				format: options.format,
				out: options.out
			});
			console.log(`Built ${options.document} into ${result.outputDir}`);
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
