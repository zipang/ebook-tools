import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExtract } from "../../src/commands/extract.ts";
import { makeEpubFixture } from "../fixtures/epub/make-fixture.ts";
import { makePdfFixture } from "../fixtures/pdf/make-fixture.ts";

const createRepository = async (): Promise<string> => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
	await Bun.write(join(repositoryRoot, "sources", "books", "alpha.epub"), makeEpubFixture());
	await Bun.write(join(repositoryRoot, "sources", "guides", "beta.pdf"), makePdfFixture());
	return repositoryRoot;
};

describe("runExtract", () => {
	test("extracts nested sources into isolated document directories", async () => {
		const repositoryRoot = await createRepository();

		try {
			const result = await runExtract({ all: true }, repositoryRoot);

			expect(result.documents).toHaveLength(2);
			expect(result.failures).toHaveLength(0);
			expect(await Bun.file(join(repositoryRoot, "documents", "alpha", "manifest.json")).exists()).toBe(
				true
			);
			expect(await Bun.file(join(repositoryRoot, "documents", "beta", "manifest.json")).exists()).toBe(
				true
			);
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("extracts one explicit source with an optional document name", async () => {
		const repositoryRoot = await createRepository();

		try {
			const result = await runExtract(
				{
					input: "sources/books/alpha.epub",
					document: "alpha-edition"
				},
				repositoryRoot
			);

			expect(result.documents[0]?.documentName).toBe("alpha-edition");
			expect(
				await Bun.file(join(repositoryRoot, "documents", "alpha-edition", "manifest.json")).exists()
			).toBe(true);
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("derives a safe document name from a spaced filename", async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
		await Bun.write(join(repositoryRoot, "sources", "My Book.epub"), makeEpubFixture());

		try {
			const result = await runExtract({ input: "sources/My Book.epub" }, repositoryRoot);

			expect(result.documents[0]?.documentName).toBe("my-book");
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("rejects a batch run without a sources directory", async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));

		try {
			await expect(runExtract({ all: true }, repositoryRoot)).rejects.toThrow("sources");
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("rejects an explicit source outside sources/", async () => {
		const repositoryRoot = await createRepository();
		await Bun.write(join(repositoryRoot, "outside.epub"), makeEpubFixture());

		try {
			await expect(runExtract({ input: "outside.epub" }, repositoryRoot)).rejects.toThrow();
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("rejects an explicit source symlink that escapes sources/", async () => {
		const repositoryRoot = await createRepository();
		const outside = await mkdtemp(join(tmpdir(), "ebook-outside-"));
		await Bun.write(join(outside, "real.epub"), makeEpubFixture());
		await symlink(join(outside, "real.epub"), join(repositoryRoot, "sources", "link.epub"));

		try {
			await expect(runExtract({ input: "sources/link.epub" }, repositoryRoot)).rejects.toThrow();
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("reports nested filename collisions before writing", async () => {
		const repositoryRoot = await createRepository();
		await Bun.write(join(repositoryRoot, "sources", "other", "alpha.epub"), makeEpubFixture());

		try {
			await expect(runExtract({ all: true }, repositoryRoot)).rejects.toThrow("collision");
			expect(await Bun.file(join(repositoryRoot, "documents", "alpha", "manifest.json")).exists()).toBe(
				false
			);
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});
});
