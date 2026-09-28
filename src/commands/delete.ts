import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	type DocumentManifest,
	type ManifestAsset,
	type ManifestUnit,
	serializeManifest
} from "../model/project.ts";
import { readDocumentManifest } from "../services/document.ts";
import { AppError } from "../shared/errors.ts";
import { resolveDocumentRoot, resolveRealPathInside, slugifyDocumentName } from "../shared/paths.ts";

export type DeleteDocumentOptions = {
	repositoryRoot: string;
	documentName: string;
	parts: number[];
};

export type DeleteDocumentResult = {
	documentDir: string;
	removedTitles: string[];
	remainingCount: number;
};

/** Return the unit id for a zero-based position. */
const unitId = (index: number): string => {
	return `unit-${String(index + 1).padStart(3, "0")}`;
};

/** Return the chapter path for a zero-based position. */
const unitPath = (index: number, title: string): string => {
	return `chapters/${String(index + 1).padStart(3, "0")}-${slugifyDocumentName(title)}.md`;
};

/** Validate the requested part numbers and return their zero-based indexes. */
const parsePartIndexes = (parts: number[], unitCount: number): Set<number> => {
	const indexes = new Set<number>();
	for (const part of parts) {
		if (!Number.isInteger(part) || part < 1 || part > unitCount) {
			throw new AppError("validation-error", `Part number is out of range: ${part}`);
		}
		indexes.add(part - 1);
	}
	if (indexes.size === 0) {
		throw new AppError("validation-error", "Specify at least one part to delete.");
	}
	if (indexes.size >= unitCount) {
		throw new AppError("validation-error", "At least one unit must remain.");
	}
	return indexes;
};

/** Rewrite /read links through the old-to-new unit id map. */
const remapReadLinks = (markdown: string, idMap: Map<string, string>): string => {
	return markdown.replace(/\(\/read\/(unit-\d+)(#[^)\s]*)?\)/g, (_match, id: string, fragment = "") => {
		const target = idMap.get(id);
		return target === undefined ? "(#)" : `(/read/${target}${fragment})`;
	});
};

/** Collect the asset paths that the remaining Markdown references. */
const collectReferencedAssets = (markdowns: string[]): Set<string> => {
	const referenced = new Set<string>();
	for (const markdown of markdowns) {
		for (const match of markdown.matchAll(/\.\.\/(assets\/images\/[^)\s"]+)/g)) {
			if (match[1] !== undefined) {
				referenced.add(match[1]);
			}
		}
	}
	return referenced;
};

/**
 * Move a path aside, and report whether there was anything to move.
 *
 * A missing source is the normal case on a first write, so ENOENT is not an
 * error. Bun recommends acting and handling the error over checking first.
 */
const moveAside = async (from: string, to: string): Promise<boolean> => {
	try {
		await rename(from, to);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
};

/**
 * Replace the chapters directory and the manifest as one unit.
 *
 * The new Markdown goes to a staging directory first. The live directory is
 * moved aside, the staging directory takes its place, and the manifest is
 * written last. A failure at any step restores the previous chapters, so a
 * document is never left with fewer units than its manifest promises.
 */
const writeProjectAtomically = async (
	documentDir: string,
	keptUnits: ManifestUnit[],
	rewritten: string[],
	manifest: DocumentManifest,
	units: ManifestUnit[],
	assets: ManifestAsset[]
): Promise<void> => {
	const chaptersDir = join(documentDir, "chapters");
	const stagingDir = join(documentDir, `.chapters-staging-${randomUUID()}`);
	const backupDir = join(documentDir, `.chapters-backup-${randomUUID()}`);
	const stagedManifest = join(documentDir, `.manifest-${randomUUID()}.json`);
	let movedAside = false;
	let swapped = false;

	try {
		await mkdir(stagingDir, { recursive: true });
		for (const [index, unit] of keptUnits.entries()) {
			await Bun.write(join(stagingDir, basename(unitPath(index, unit.title))), rewritten[index] ?? "");
		}

		movedAside = await moveAside(chaptersDir, backupDir);
		await rename(stagingDir, chaptersDir);
		swapped = true;

		await Bun.write(stagedManifest, serializeManifest({ ...manifest, units, assets }));
		await rename(stagedManifest, join(documentDir, "manifest.json"));

		await rm(backupDir, { recursive: true, force: true });
	} catch (error) {
		await rm(stagingDir, { recursive: true, force: true });
		await rm(stagedManifest, { force: true });

		if (swapped) {
			await rm(chaptersDir, { recursive: true, force: true });
		}
		if (movedAside) {
			await rename(backupDir, chaptersDir);
		}
		throw error;
	}
};

/** Delete units from a document, renumber the rest, and prune unused images. */
export const deleteDocumentParts = async (options: DeleteDocumentOptions): Promise<DeleteDocumentResult> => {
	const documentDir = resolveDocumentRoot(options.repositoryRoot, options.documentName);
	const manifest = await readDocumentManifest(documentDir);
	const indexes = parsePartIndexes(options.parts, manifest.units.length);

	const removedTitles: string[] = [];
	const keptUnits: ManifestUnit[] = [];
	for (const [index, unit] of manifest.units.entries()) {
		if (indexes.has(index)) {
			removedTitles.push(unit.title);
			continue;
		}
		keptUnits.push(unit);
	}

	const idMap = new Map<string, string>();
	keptUnits.forEach((unit, index) => {
		idMap.set(unit.id, unitId(index));
	});

	const rewritten: string[] = [];
	for (const unit of keptUnits) {
		const safePath = await resolveRealPathInside(documentDir, join(documentDir, unit.path));
		rewritten.push(remapReadLinks(await Bun.file(safePath).text(), idMap));
	}

	const units: ManifestUnit[] = keptUnits.map((unit, index) => ({
		id: unitId(index),
		title: unit.title,
		path: unitPath(index, unit.title),
		source: unit.source
	}));

	const referenced = collectReferencedAssets(rewritten);
	const assets = manifest.assets.filter((asset) => referenced.has(asset.path));

	await writeProjectAtomically(documentDir, keptUnits, rewritten, manifest, units, assets);

	for (const asset of manifest.assets) {
		if (!referenced.has(asset.path)) {
			await rm(join(documentDir, asset.path), { force: true });
		}
	}

	return { documentDir, removedTitles, remainingCount: units.length };
};

/** Run the delete command for one extracted document. */
export const runDelete = async (options: DeleteDocumentOptions): Promise<DeleteDocumentResult> => {
	return deleteDocumentParts(options);
};
