import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { SourceFormat } from "../model/document.ts";
import { AppError } from "./errors.ts";
import { slugifyDocumentName, toManifestPath } from "./paths.ts";

export type DiscoveredSource = {
	path: string;
	relativePath: string;
	format: SourceFormat;
	documentName: string;
};

export type SourceDiscoveryResult = {
	sources: DiscoveredSource[];
	skippedPaths: string[];
};

/** Return the source format for a supported file extension. */
const getFormat = (path: string): SourceFormat | undefined => {
	const extension = extname(path).toLowerCase();
	if (extension === ".epub") {
		return "epub";
	}
	if (extension === ".pdf") {
		return "pdf";
	}
	return undefined;
};

/** Add the supported source files of one directory to the result. */
const discoverDirectory = async (
	directory: string,
	repositoryRoot: string,
	result: SourceDiscoveryResult,
	isRoot = false
): Promise<void> => {
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (isRoot) {
			throw new AppError("validation-error", `Unable to read sources/: ${String(error)}`);
		}
		result.skippedPaths.push(toManifestPath(relative(repositoryRoot, directory)));
		return;
	}

	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			await discoverDirectory(path, repositoryRoot, result);
			continue;
		}
		if (!entry.isFile()) {
			result.skippedPaths.push(toManifestPath(relative(repositoryRoot, path)));
			continue;
		}

		const format = getFormat(path);
		const relativePath = toManifestPath(relative(repositoryRoot, path));
		if (format === undefined) {
			result.skippedPaths.push(relativePath);
			continue;
		}

		result.sources.push({
			path,
			relativePath,
			format,
			documentName: slugifyDocumentName(path)
		});
	}
};

/** Recursively discover supported source files under sources/. */
export const discoverSources = async (repositoryRoot: string): Promise<SourceDiscoveryResult> => {
	const result: SourceDiscoveryResult = { sources: [], skippedPaths: [] };
	await discoverDirectory(join(repositoryRoot, "sources"), repositoryRoot, result, true);
	result.sources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
	result.skippedPaths.sort((left, right) => left.localeCompare(right));
	return result;
};
