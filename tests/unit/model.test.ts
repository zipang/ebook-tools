import { describe, expect, test } from "bun:test";
import type { ExtractedDocument } from "../../src/model/document.ts";
import { createManifest, validateManifest } from "../../src/model/project.ts";
import { isPathInside, resolveDocumentRoot, slugifyDocumentName } from "../../src/shared/paths.ts";

const createDocument = (): ExtractedDocument => ({
	title: "Example Book",
	language: "en",
	source: {
		format: "epub",
		path: "sources/Example Book.epub",
		size: 42
	},
	units: [
		{
			id: "chapter-001",
			title: "Chapter 1",
			source: { sourcePath: "sources/Example Book.epub", spineIndex: 0 },
			blocks: [
				{
					kind: "heading",
					level: 1,
					children: [{ kind: "text", text: "Chapter 1" }]
				}
			]
		}
	],
	assets: [],
	warnings: []
});

describe("document names and paths", () => {
	test("creates a safe document slug", () => {
		expect(slugifyDocumentName("Don't Make Me Think (1984).epub")).toBe("don-t-make-me-think-1984");
	});

	test("rejects document names that can escape documents", () => {
		expect(() => resolveDocumentRoot("/library", "../outside")).toThrow();
	});

	test("checks whether a path stays inside a root", () => {
		expect(isPathInside("/library/documents/book", "/library/documents/book/chapter.md")).toBe(true);
		expect(isPathInside("/library/documents/book", "/library/documents/other/chapter.md")).toBe(false);
	});
});

describe("manifest", () => {
	test("creates a manifest from an extracted document", () => {
		const manifest = createManifest("example-book", createDocument());

		expect(manifest.id).toBe("example-book");
		expect(manifest.units[0]?.path).toBe("chapters/001-chapter-1.md");
		expect(manifest.source.path).toBe("sources/Example Book.epub");
	});

	test("rejects a manifest with an unsafe unit path", () => {
		const manifest = createManifest("example-book", createDocument());
		const firstUnit = manifest.units[0];
		if (firstUnit === undefined) {
			throw new Error("Expected a manifest unit");
		}
		firstUnit.path = "../outside.md";

		expect(() => validateManifest(manifest)).toThrow();
	});

	test("rejects a manifest with an unsafe unit id", () => {
		const manifest = createManifest("example-book", createDocument());
		const firstUnit = manifest.units[0];
		if (firstUnit === undefined) {
			throw new Error("Expected a manifest unit");
		}
		firstUnit.id = "../../escape";

		expect(() => validateManifest(manifest)).toThrow();
	});

	test("requires units and assets to stay in their contract directories", () => {
		const manifest = createManifest("example-book", createDocument());
		const firstUnit = manifest.units[0];
		if (firstUnit === undefined) {
			throw new Error("Expected a manifest unit");
		}
		firstUnit.path = "reports/outside.md";

		expect(() => validateManifest(manifest)).toThrow();
	});

	test("derives right-to-left direction from the language", () => {
		const document = createDocument();
		document.language = "ar";
		const manifest = createManifest("example-book", document);

		expect(manifest.direction).toBe("rtl");
	});
});
