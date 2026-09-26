import { join, relative, resolve } from "node:path";
import type { SourceFormat } from "../model/document.ts";
import { AppError } from "../shared/errors.ts";
import { isPathInside, resolveRealPathInside, slugifyDocumentName, toManifestPath } from "../shared/paths.ts";
import { type DiscoveredSource, discoverSources } from "../shared/source-discovery.ts";
import { epubExtractor } from "./epub.ts";
import { pdfExtractor } from "./pdf.ts";
import { type WriteExtractedDocumentResult, writeExtractedDocument } from "./writer.ts";

export type ExtractFailure = {
	sourcePath: string;
	message: string;
};

export type ExtractRunResult = {
	documents: WriteExtractedDocumentResult[];
	failures: ExtractFailure[];
	skippedPaths: string[];
};

export type ExtractSourceOptions = {
	repositoryRoot: string;
	sourcePath: string;
	documentName: string;
	force?: boolean;
};

/** Return the source format for a supported file path. */
const getSourceFormat = (path: string): SourceFormat => {
	const lowerPath = path.toLowerCase();
	if (lowerPath.endsWith(".epub")) {
		return "epub";
	}
	if (lowerPath.endsWith(".pdf")) {
		return "pdf";
	}
	throw new AppError("unsupported-structure", `Unsupported source format: ${path}`);
};

/** Reject a source file with an invalid file signature. */
const assertFileSignature = (format: SourceFormat, bytes: Uint8Array, path: string): void => {
	if (format === "epub" && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) {
		throw new AppError("malformed-source", `EPUB has an invalid ZIP signature: ${path}`);
	}
	if (format === "pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
		throw new AppError("malformed-source", `PDF has an invalid header: ${path}`);
	}
};

/** Extract one source file into one document project. */
export const extractSource = async (options: ExtractSourceOptions): Promise<WriteExtractedDocumentResult> => {
	const repositoryRoot = resolve(options.repositoryRoot);
	const sourcePath = resolve(repositoryRoot, options.sourcePath);
	const sourcesRoot = join(repositoryRoot, "sources");
	if (!isPathInside(sourcesRoot, sourcePath)) {
		throw new AppError("validation-error", `Source must stay inside sources/: ${options.sourcePath}`);
	}
	await resolveRealPathInside(sourcesRoot, sourcePath);
	const format = getSourceFormat(sourcePath);
	const bytes = new Uint8Array(await Bun.file(sourcePath).arrayBuffer());
	assertFileSignature(format, bytes, options.sourcePath);
	const relativePath = toManifestPath(relative(repositoryRoot, sourcePath));
	const adapter = format === "epub" ? epubExtractor : pdfExtractor;
	const document = await adapter.extract({ sourcePath: relativePath, format, bytes });
	const writeOptions = {
		repositoryRoot,
		documentName: options.documentName,
		document,
		...(options.force === undefined ? {} : { force: options.force })
	};
	return writeExtractedDocument(writeOptions);
};

/** Group discovered sources by their derived document name. */
const findCollisions = (sources: DiscoveredSource[]): Map<string, DiscoveredSource[]> => {
	const grouped = new Map<string, DiscoveredSource[]>();
	for (const source of sources) {
		const group = grouped.get(source.documentName) ?? [];
		group.push(source);
		grouped.set(source.documentName, group);
	}
	return grouped;
};

/** Extract every supported source found under sources/. */
export const extractBatch = async (repositoryRoot: string, force = false): Promise<ExtractRunResult> => {
	const discovery = await discoverSources(repositoryRoot);
	const grouped = findCollisions(discovery.sources);
	const collisions = [...grouped.entries()].filter(([, sources]) => sources.length > 1);
	if (collisions.length > 0) {
		const details = collisions
			.map(([name, sources]) => `${name}: ${sources.map((source) => source.relativePath).join(", ")}`)
			.join("; ");
		throw new AppError("name-collision", `Document name collision detected: ${details}`);
	}

	const documents: WriteExtractedDocumentResult[] = [];
	const failures: ExtractFailure[] = [];
	for (const source of discovery.sources) {
		try {
			documents.push(
				await extractSource({
					repositoryRoot,
					sourcePath: source.path,
					documentName: source.documentName,
					force
				})
			);
		} catch (error) {
			failures.push({
				sourcePath: source.relativePath,
				message: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return { documents, failures, skippedPaths: discovery.skippedPaths };
};

/** Run the extraction command for one source or the complete source library. */
export const extractCommand = async (
	options: { input?: string; document?: string; all?: boolean; force?: boolean },
	repositoryRoot: string
): Promise<ExtractRunResult> => {
	const hasInput = options.input !== undefined;
	const hasAll = options.all === true;
	if (hasInput === hasAll) {
		throw new AppError("validation-error", "Specify exactly one of --input or --all.");
	}

	if (hasAll) {
		return extractBatch(repositoryRoot, options.force ?? false);
	}

	const sourcePath = options.input as string;
	const documentName = options.document ?? slugifyDocumentName(sourcePath);
	const document = await extractSource({
		repositoryRoot,
		sourcePath,
		documentName,
		...(options.force === undefined ? {} : { force: options.force })
	});
	return { documents: [document], failures: [], skippedPaths: [] };
};
