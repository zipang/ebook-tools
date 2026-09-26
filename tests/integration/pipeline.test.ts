import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDocument } from "../../src/commands/build.ts";
import { runExtract } from "../../src/commands/extract.ts";
import { startDocumentServer } from "../../src/server/server.ts";
import { makeEpubFixture } from "../fixtures/epub/make-fixture.ts";
import { makePdfFixture } from "../fixtures/pdf/make-fixture.ts";

describe("T0001 pipeline", () => {
	test("runs the local source-to-preview-to-build workflow", async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
		const sourcePath = join(repositoryRoot, "sources", "library", "book.epub");
		const pdfPath = join(repositoryRoot, "sources", "library", "guide.pdf");
		const sourceBytes = makeEpubFixture();
		await Bun.write(sourcePath, sourceBytes);
		await Bun.write(pdfPath, makePdfFixture());
		let server: Awaited<ReturnType<typeof startDocumentServer>> | undefined;

		try {
			const extraction = await runExtract({ all: true }, repositoryRoot);
			expect(extraction.documents).toHaveLength(2);
			expect(await readFile(sourcePath)).toEqual(Buffer.from(sourceBytes));

			server = await startDocumentServer({
				repositoryRoot,
				documentName: "book",
				host: "127.0.0.1",
				port: 0
			});
			const index = await fetch(`http://127.0.0.1:${server.port}/`);
			expect(index.status).toBe(200);

			const html = await buildDocument({
				repositoryRoot,
				documentName: "book",
				format: "html",
				out: "generated/html"
			});
			const pdf = await buildDocument({
				repositoryRoot,
				documentName: "book",
				format: "pdf",
				out: "generated/pdf"
			});
			const htmlText = await readFile(join(html.outputDir, "chapters", "unit-001.html"), "utf8");
			const pdfBytes = await readFile(join(pdf.outputDir, "document.pdf"));

			expect(htmlText).toContain("Chapter 1");
			expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
		} finally {
			if (server !== undefined) {
				await server.stop(true);
			}
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});
});
