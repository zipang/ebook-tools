import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteDocumentParts } from "../../src/commands/delete.ts";
import { runExtract } from "../../src/commands/extract.ts";
import { makeSpineEpubFixture, PIXEL_PNG } from "../fixtures/epub/make-fixture.ts";

const createRepository = async (): Promise<string> => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
	await Bun.write(
		join(repositoryRoot, "sources", "library", "book.epub"),
		makeSpineEpubFixture(
			[
				{ href: "a.xhtml", body: '<h2>Alpha</h2><p>See <a href="c.xhtml">gamma</a>.</p>' },
				{
					href: "b.xhtml",
					body: '<h2>Beta</h2><p>Beta body.</p><p><img src="../images/beta.png" alt="Beta"/></p>'
				},
				{ href: "c.xhtml", body: "<h2>Gamma</h2><p>Gamma body.</p>" }
			],
			{ "beta.png": PIXEL_PNG }
		)
	);
	await runExtract({ input: "sources/library/book.epub" }, repositoryRoot);
	return repositoryRoot;
};

describe("deleteDocumentParts", () => {
	test("removes units, renumbers the rest, remaps links, and prunes images", async () => {
		const repositoryRoot = await createRepository();

		try {
			const documentDir = join(repositoryRoot, "documents", "book");
			const result = await deleteDocumentParts({
				repositoryRoot,
				documentName: "book",
				parts: [2]
			});

			expect(result.removedTitles).toEqual(["Beta"]);
			expect(result.remainingCount).toBe(2);

			const manifest = await Bun.file(join(documentDir, "manifest.json")).json();
			expect(manifest.units.map((unit: { id: string }) => unit.id)).toEqual(["unit-001", "unit-002"]);
			expect(manifest.units.map((unit: { title: string }) => unit.title)).toEqual(["Alpha", "Gamma"]);
			expect(manifest.units.map((unit: { path: string }) => unit.path)).toEqual([
				"chapters/001-alpha.md",
				"chapters/002-gamma.md"
			]);
			expect(manifest.assets).toHaveLength(0);

			const alpha = await Bun.file(join(documentDir, "chapters", "001-alpha.md")).text();
			expect(alpha).toContain("(/read/unit-002)");
			expect(await Bun.file(join(documentDir, "chapters", "002-beta.md")).exists()).toBe(false);
			expect(await Bun.file(join(documentDir, "chapters", "003-gamma.md")).exists()).toBe(false);
			expect(await Bun.file(join(documentDir, "assets", "images", "beta.png")).exists()).toBe(false);
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("rejects out-of-range parts and deletion of every unit", async () => {
		const repositoryRoot = await createRepository();

		try {
			await expect(
				deleteDocumentParts({ repositoryRoot, documentName: "book", parts: [9] })
			).rejects.toThrow("out of range");
			await expect(
				deleteDocumentParts({ repositoryRoot, documentName: "book", parts: [1, 2, 3] })
			).rejects.toThrow("must remain");
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});
});
