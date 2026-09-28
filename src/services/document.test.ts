import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExtractedDocument } from "../extract/writer.ts";
import type { ExtractedDocument } from "../model/document.ts";
import { nextUnitId } from "../model/project.ts";
import { AppError } from "../shared/errors.ts";
import { loadDocumentContext, readDocumentManifest } from "./document.ts";

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
		markdown: `# Chapter ${index + 1}\n\nBody text.\n`
	})),
	assets: [],
	warnings: []
});

beforeEach(async () => {
	repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-document-service-"));
	await writeExtractedDocument({
		repositoryRoot,
		documentName: "sample-book",
		document: buildDocument(3)
	});
});

afterEach(async () => {
	await rm(repositoryRoot, { recursive: true, force: true });
});

test("loads a document by directory path, with no server running", async () => {
	const documentDir = join(repositoryRoot, "documents", "sample-book");
	const context = await loadDocumentContext(documentDir);

	expect(context.documentDir).toBe(documentDir);
	expect(context.manifest.id).toBe("sample-book");
	expect(context.manifest.title).toBe("Sample Book");
	expect(context.manifest.units).toHaveLength(3);
});

test("loads the document templates from the project directory", async () => {
	const context = await loadDocumentContext(join(repositoryRoot, "documents", "sample-book"));

	expect(context.templates.base).toContain("<html");
	expect(context.templates.styles.length).toBeGreaterThan(0);
});

test("reads and validates the manifest on its own", async () => {
	const manifest = await readDocumentManifest(join(repositoryRoot, "documents", "sample-book"));

	expect(manifest.schemaVersion).toBe(1);
	expect(manifest.units.map((unit) => unit.id)).toEqual(["unit-001", "unit-002", "unit-003"]);
});

test("rejects a manifest whose schema version is wrong", async () => {
	const documentDir = join(repositoryRoot, "documents", "sample-book");
	const manifestPath = join(documentDir, "manifest.json");
	const manifest = await Bun.file(manifestPath).json();
	await Bun.write(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 99 }));

	await expect(readDocumentManifest(documentDir)).rejects.toThrow(AppError);
});

test("rejects a directory that does not exist", async () => {
	await expect(readDocumentManifest(join(repositoryRoot, "documents", "absent"))).rejects.toThrow(AppError);
});

test("rejects a document directory that is a symbolic link", async () => {
	const real = join(repositoryRoot, "documents", "sample-book");
	const link = join(repositoryRoot, "documents", "linked-book");
	await symlink(real, link);

	await expect(loadDocumentContext(link)).rejects.toThrow(/Symbolic links/);
});
