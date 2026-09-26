import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocument } from "../../src/commands/build.ts";
import { writeExtractedDocument } from "../../src/extract/writer.ts";
import type { ExtractedDocument } from "../../src/model/document.ts";

const PIXEL_PNG = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
	(character) => character.charCodeAt(0)
);

const createProject = async (): Promise<string> => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
	const document: ExtractedDocument = {
		title: "Buildable Book",
		language: "en",
		source: { format: "epub", path: "sources/buildable.epub", size: 10 },
		units: [
			{
				id: "unit-001",
				title: "First",
				source: { sourcePath: "sources/buildable.epub", spineIndex: 0 },
				blocks: [
					{
						kind: "paragraph",
						children: [
							{ kind: "text", text: "Figure: " },
							{ kind: "image", assetId: "asset-001", altText: "Pixel" }
						]
					}
				]
			}
		],
		assets: [
			{
				id: "asset-001",
				path: "assets/images/pixel.png",
				bytes: PIXEL_PNG,
				mimeType: "image/png"
			}
		],
		warnings: []
	};
	await writeExtractedDocument({ repositoryRoot, documentName: "buildable-book", document });
	return repositoryRoot;
};

describe("buildDocument", () => {
	test("builds navigable static HTML and copies assets", async () => {
		const repositoryRoot = await createProject();

		try {
			const result = await buildDocument({
				repositoryRoot,
				documentName: "buildable-book",
				format: "html",
				out: "build/html"
			});
			const index = await readFile(join(result.outputDir, "index.html"), "utf8");
			const unit = await readFile(join(result.outputDir, "chapters", "unit-001.html"), "utf8");

			expect(index).toContain("Buildable Book");
			expect(index).toContain("chapters/unit-001.html");
			expect(unit).toContain("First");
			expect(await Bun.file(join(result.outputDir, "assets", "images", "pixel.png")).exists()).toBe(
				true
			);
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("rejects a symlinked assets directory", async () => {
		const repositoryRoot = await createProject();
		const outside = await mkdtemp(join(tmpdir(), "ebook-outside-"));
		await rm(join(repositoryRoot, "documents", "buildable-book", "assets"), {
			recursive: true,
			force: true
		});
		await symlink(outside, join(repositoryRoot, "documents", "buildable-book", "assets"));

		try {
			await expect(
				buildDocument({
					repositoryRoot,
					documentName: "buildable-book",
					format: "html",
					out: "build/html"
				})
			).rejects.toThrow();
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("builds a valid PDF", async () => {
		const repositoryRoot = await createProject();

		try {
			const result = await buildDocument({
				repositoryRoot,
				documentName: "buildable-book",
				format: "pdf",
				out: "build/pdf"
			});
			const pdf = await readFile(join(result.outputDir, "document.pdf"));

			expect(pdf.byteLength).toBeGreaterThan(100);
			expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
			expect(pdf.includes(Buffer.from("/Subtype /Image"))).toBe(true);
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});
});
