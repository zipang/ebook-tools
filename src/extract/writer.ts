import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { serializeDocumentUnit } from "../markdown/serialize.ts";
import type { ExtractedDocument } from "../model/document.ts";
import { createManifest, type DocumentManifest, serializeManifest } from "../model/project.ts";
import { AppError } from "../shared/errors.ts";
import { resolveDocumentRoot, toManifestPath } from "../shared/paths.ts";
import {
	createExtractionReport,
	renderExtractionReport,
	serializeExtractionReport
} from "../shared/report.ts";

export type WriteExtractedDocumentOptions = {
	repositoryRoot: string;
	documentName: string;
	document: ExtractedDocument;
	force?: boolean;
};

export type WriteExtractedDocumentResult = {
	documentName: string;
	documentDir: string;
	manifest: DocumentManifest;
	unitCount: number;
	imageCount: number;
	warningCount: number;
};

/** Load the built-in document templates. */
const loadDefaultTemplates = async (): Promise<{ base: string; styles: string }> => {
	const [base, styles] = await Promise.all([
		Bun.file(new URL("../templates/default/base.html", import.meta.url)).text(),
		Bun.file(new URL("../templates/default/print.css", import.meta.url)).text()
	]);
	return { base, styles };
};

/** Check whether a path exists. */
const pathExists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};

/** Validate an asset path and return its manifest form. */
const assertRelativeAssetPath = (path: string): string => {
	const normalized = toManifestPath(path);
	if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
		throw new AppError("validation-error", `Unsafe asset path: ${path}`);
	}
	return normalized;
};

/** Write a text file and create its parent directory. */
const writeText = async (path: string, content: string): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(path, content);
};

/** Write a binary file and create its parent directory. */
const writeBytes = async (path: string, content: Uint8Array): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(path, content);
};

/** Write every file of one extracted document project. */
const writeProjectFiles = async (
	documentDir: string,
	document: ExtractedDocument,
	manifest: DocumentManifest
): Promise<void> => {
	const assetPaths = new Map(
		document.assets.map((asset) => [asset.id, assertRelativeAssetPath(asset.path)])
	);
	const report = createExtractionReport(document);

	await mkdir(join(documentDir, "chapters"), { recursive: true });
	await mkdir(join(documentDir, "assets", "images"), { recursive: true });
	await mkdir(join(documentDir, "templates"), { recursive: true });
	await mkdir(join(documentDir, "reports"), { recursive: true });
	await mkdir(join(documentDir, "generated"), { recursive: true });

	await writeText(join(documentDir, "manifest.json"), serializeManifest(manifest));

	for (const [index, unit] of document.units.entries()) {
		const manifestUnit = manifest.units[index];
		if (manifestUnit === undefined) {
			throw new AppError("write-failed", `Missing manifest unit for ${unit.id}`);
		}
		await writeText(join(documentDir, manifestUnit.path), serializeDocumentUnit(unit, { assetPaths }));
	}

	for (const asset of document.assets) {
		const path = assertRelativeAssetPath(asset.path);
		if (!path.startsWith("assets/")) {
			throw new AppError("validation-error", `Asset must be under assets/: ${path}`);
		}
		await writeBytes(join(documentDir, path), asset.bytes);
	}

	const defaultTemplates = await loadDefaultTemplates();
	await writeText(join(documentDir, "templates", "base.html"), defaultTemplates.base);
	await writeText(join(documentDir, "templates", "print.css"), defaultTemplates.styles);
	await writeText(join(documentDir, "reports", "extraction.md"), renderExtractionReport(report));
	await writeText(join(documentDir, "reports", "extraction.json"), serializeExtractionReport(report));
};

/** Write an extracted document into an isolated library directory. */
export const writeExtractedDocument = async (
	options: WriteExtractedDocumentOptions
): Promise<WriteExtractedDocumentResult> => {
	const documentDir = resolveDocumentRoot(options.repositoryRoot, options.documentName);
	const shouldForce = options.force ?? false;
	const targetExists = await pathExists(documentDir);

	if (targetExists) {
		const entries = await readdir(documentDir);
		if (entries.length > 0 && !shouldForce) {
			throw new AppError("target-exists", `Document directory already exists: ${documentDir}`);
		}
	}

	const manifest = createManifest(options.documentName, options.document);
	const temporaryDir = `${documentDir}.tmp-${randomUUID()}`;
	const backupDir = `${documentDir}.backup-${randomUUID()}`;
	let movedExistingDirectory = false;

	try {
		await writeProjectFiles(temporaryDir, options.document, manifest);
		if (targetExists) {
			await rename(documentDir, backupDir);
			movedExistingDirectory = true;
		}
		await rename(temporaryDir, documentDir);
		if (movedExistingDirectory) {
			await rm(backupDir, { recursive: true, force: true });
		}
	} catch (error) {
		await rm(temporaryDir, { recursive: true, force: true });
		if (movedExistingDirectory && !(await pathExists(documentDir))) {
			await rename(backupDir, documentDir);
		}
		throw error;
	}

	return {
		documentName: options.documentName,
		documentDir,
		manifest,
		unitCount: options.document.units.length,
		imageCount: options.document.assets.length,
		warningCount: options.document.warnings.length
	};
};
