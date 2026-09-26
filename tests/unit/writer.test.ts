import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExtractedDocument } from "../../src/extract/writer.ts";
import { serializeDocumentUnit } from "../../src/markdown/serialize.ts";
import type { DocumentUnit, ExtractedDocument } from "../../src/model/document.ts";

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
				},
				{
					kind: "paragraph",
					children: [
						{ kind: "text", text: "See " },
						{
							kind: "image",
							assetId: "figure-001",
							altText: "A figure"
						}
					]
				}
			]
		}
	],
	assets: [
		{
			id: "figure-001",
			path: "assets/images/figure-001.png",
			bytes: new Uint8Array([137, 80, 78, 71]),
			mimeType: "image/png",
			altText: "A figure"
		}
	],
	warnings: [
		{
			code: "low-confidence",
			message: "Check the first paragraph.",
			severity: "warning",
			location: { sourcePath: "sources/Example Book.epub", page: 1, confidence: 0.4 }
		}
	]
});

describe("writeExtractedDocument", () => {
	test("writes a self-contained document project", async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));

		try {
			const result = await writeExtractedDocument({
				repositoryRoot,
				documentName: "example-book",
				document: createDocument()
			});

			expect(result.unitCount).toBe(1);
			expect(result.imageCount).toBe(1);
			expect(result.warningCount).toBe(1);

			const documentDir = join(repositoryRoot, "documents", "example-book");
			const markdown = await readFile(join(documentDir, "chapters", "001-chapter-1.md"), "utf8");
			const manifest = await readFile(join(documentDir, "manifest.json"), "utf8");
			const report = await readFile(join(documentDir, "reports", "extraction.md"), "utf8");

			expect(markdown).toContain("![A figure](../assets/images/figure-001.png)");
			expect(manifest).toContain('"schemaVersion": 1');
			expect(report).toContain("Check the first paragraph.");
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("prefers adapter-provided Markdown over the block list", () => {
		const unit: DocumentUnit = {
			id: "unit-001",
			title: "Chapter 1",
			source: { sourcePath: "sources/Example Book.epub", spineIndex: 0 },
			blocks: [{ kind: "paragraph", children: [{ kind: "text", text: "ignored" }] }],
			markdown: "# Chapter 1\n\nFrom HTML."
		};

		expect(serializeDocumentUnit(unit)).toBe("# Chapter 1\n\nFrom HTML.");
	});

	test("refuses to replace an existing project by default", async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
		const options = {
			repositoryRoot,
			documentName: "example-book",
			document: createDocument()
		};

		try {
			await writeExtractedDocument(options);
			await expect(writeExtractedDocument(options)).rejects.toThrow("already exists");
			await expect(writeExtractedDocument({ ...options, force: true })).resolves.toBeDefined();
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});
});
