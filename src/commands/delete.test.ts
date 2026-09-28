import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExtractedDocument } from "../extract/writer.ts";
import type { ExtractedDocument } from "../model/document.ts";
import { nextUnitId } from "../model/project.ts";
import { AppError } from "../shared/errors.ts";
import { deleteDocumentParts } from "./delete.ts";

let repositoryRoot = "";

/** Build a minimal in-memory document with the requested number of units. */
const buildDocument = (unitCount: number): ExtractedDocument => ({
	title: "Sample Book",
	language: "en",
	source: { format: "epub", path: "sources/sample-book.epub", size: 1024 },
	units: Array.from({ length: unitCount }, (_unused, index) => ({
		id: nextUnitId(index),
		title: `Chapter ${index + 1}`,
		source: { sourcePath: "sources/sample-book.epub", spineIndex: index },
		blocks: [],
		markdown: `# Chapter ${index + 1}\n\nSee [next](/read/unit-003).\n`
	})),
	assets: [],
	warnings: []
});

/** The project directory the tests operate on. */
const documentDir = (): string => join(repositoryRoot, "documents", "sample-book");
/** The chapters directory of that project, which every delete rewrites. */
const chaptersDir = (): string => join(documentDir(), "chapters");

beforeEach(async () => {
	repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-delete-"));
	await writeExtractedDocument({
		repositoryRoot,
		documentName: "sample-book",
		document: buildDocument(4)
	});
});

afterEach(async () => {
	await rm(repositoryRoot, { recursive: true, force: true });
});

test("removes the requested units and renumbers the rest", async () => {
	const result = await deleteDocumentParts({
		repositoryRoot,
		documentName: "sample-book",
		parts: [2]
	});

	expect(result.removedTitles).toEqual(["Chapter 2"]);
	expect(result.remainingCount).toBe(3);

	const files = (await readdir(chaptersDir())).sort();

	expect(files).toEqual(["001-chapter-1.md", "002-chapter-3.md", "003-chapter-4.md"]);
});

test("renumbers the unit ids in the manifest", async () => {
	await deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [2] });

	const manifest = await Bun.file(join(documentDir(), "manifest.json")).json();

	expect(manifest.units.map((unit: { id: string }) => unit.id)).toEqual([
		"unit-001",
		"unit-002",
		"unit-003"
	]);
});

test("rewrites internal links to the new unit numbers", async () => {
	await deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [2] });

	// Chapter 3 was unit-003 and is now unit-002, so the link follows it.
	const rewritten = await readFile(join(chaptersDir(), "001-chapter-1.md"), "utf8");

	expect(rewritten).toContain("(/read/unit-002)");
});

test("neutralises a link that pointed at a deleted unit", async () => {
	// Point chapter 1 at the unit that is about to be removed.
	await writeFile(join(chaptersDir(), "001-chapter-1.md"), "# Chapter 1\n\nSee [gone](/read/unit-002).\n");

	await deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [2] });

	const rewritten = await readFile(join(chaptersDir(), "001-chapter-1.md"), "utf8");

	expect(rewritten).toContain("[gone](#)");
});

test("rejects a part number that does not exist", async () => {
	await expect(
		deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [99] })
	).rejects.toThrow(AppError);
});

test("refuses to delete every unit", async () => {
	await expect(
		deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [1, 2, 3, 4] })
	).rejects.toThrow(/At least one unit must remain/);
});

test("leaves the original chapters readable when the swap fails", async () => {
	const before = (await readdir(chaptersDir())).sort();

	// Make the staging write fail after the manifest is read, by removing write
	// access on the project directory for the duration of the call.
	await chmod(documentDir(), 0o500);

	try {
		await deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [2] });
	} catch {
		// The write is expected to fail. The originals must survive it.
	} finally {
		await chmod(documentDir(), 0o700);
	}

	const after = (await readdir(chaptersDir())).sort();
	expect(after).toEqual(before);

	const manifest = await Bun.file(join(documentDir(), "manifest.json")).json();
	expect(manifest.units).toHaveLength(4);
});

test("leaves no staging or backup directory behind after a successful run", async () => {
	await deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [2] });

	const leftovers = (await readdir(documentDir())).filter(
		(entry) => entry.startsWith(".chapters-") || entry.startsWith(".manifest-")
	);

	expect(leftovers).toEqual([]);
});

test("prunes an asset that no remaining unit references", async () => {
	const assetsDir = join(documentDir(), "assets", "images");
	await mkdir(assetsDir, { recursive: true });
	await writeFile(join(assetsDir, "used.png"), "x");
	await writeFile(join(assetsDir, "unused.png"), "x");
	await writeFile(join(chaptersDir(), "001-chapter-1.md"), "![used](../assets/images/used.png)\n");

	const manifestPath = join(documentDir(), "manifest.json");
	const manifest = await Bun.file(manifestPath).json();
	manifest.assets = [
		{ id: "asset-001", path: "assets/images/used.png", mimeType: "image/png" },
		{ id: "asset-002", path: "assets/images/unused.png", mimeType: "image/png" }
	];
	await Bun.write(manifestPath, JSON.stringify(manifest));

	await deleteDocumentParts({ repositoryRoot, documentName: "sample-book", parts: [2, 3, 4] });

	const remaining = (await readdir(assetsDir)).sort();

	expect(remaining).toEqual(["used.png"]);
});
