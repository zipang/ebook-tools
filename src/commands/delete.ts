import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type ManifestAsset, type ManifestUnit, serializeManifest } from "../model/project.ts";
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

	for (const unit of manifest.units) {
		await rm(join(documentDir, unit.path), { force: true });
	}
	await mkdir(join(documentDir, "chapters"), { recursive: true });

	const units: ManifestUnit[] = [];
	for (const [index, unit] of keptUnits.entries()) {
		const path = unitPath(index, unit.title);
		await Bun.write(join(documentDir, path), rewritten[index] ?? "");
		units.push({ id: unitId(index), title: unit.title, path, source: unit.source });
	}

	const referenced = collectReferencedAssets(rewritten);
	const assets: ManifestAsset[] = [];
	for (const asset of manifest.assets) {
		if (referenced.has(asset.path)) {
			assets.push(asset);
			continue;
		}
		await rm(join(documentDir, asset.path), { force: true });
	}

	await Bun.write(join(documentDir, "manifest.json"), serializeManifest({ ...manifest, units, assets }));

	return { documentDir, removedTitles, remainingCount: units.length };
};

/** Run the delete command for one extracted document. */
export const runDelete = async (options: DeleteDocumentOptions): Promise<DeleteDocumentResult> => {
	return deleteDocumentParts(options);
};
