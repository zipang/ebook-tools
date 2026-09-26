import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExtract } from "../../src/commands/extract.ts";
import { runTranslate } from "../../src/commands/translate.ts";
import { ValidationError } from "../../src/shared/errors.ts";
import type { ModelRunner } from "../../src/translate/types.ts";
import { makeSpineEpubFixture } from "../fixtures/epub/make-fixture.ts";

let repositoryRoot = "";

const fakeModel: ModelRunner = async (input) => ({
	text: input.markdown,
	usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
});

const baseOptions = {
	document: "book",
	to: "fr",
	force: false,
	cache: true,
	bestEffort: false
};

beforeEach(async () => {
	repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-translate-cmd-"));
	await Bun.write(
		join(repositoryRoot, "sources", "library", "book.epub"),
		makeSpineEpubFixture([
			{ href: "a.xhtml", body: "<h1>Alpha</h1><p>First unit.</p>" },
			{ href: "b.xhtml", body: "<h1>Beta</h1><p>Second unit.</p>" }
		])
	);
	await runExtract({ input: "sources/library/book.epub" }, repositoryRoot);
});

afterEach(async () => {
	await rm(repositoryRoot, { recursive: true, force: true });
});

describe("runTranslate", () => {
	test("translates a document and returns a summary", async () => {
		const result = await runTranslate(baseOptions, repositoryRoot, { runModel: fakeModel });

		expect(result.translated).toBe(2);
		expect(result.failed).toBe(0);
		expect(result.dryRun).toBe(false);
		expect(result.outputDir).toContain("book-fr");
	});

	test("estimates the cost without calling a model in a dry run", async () => {
		let calls = 0;
		const counting: ModelRunner = async (input) => {
			calls += 1;

			return {
				text: input.markdown,
				usage: { noCacheTokens: 1, cacheReadTokens: 0, outputTokens: 1 }
			};
		};

		const result = await runTranslate({ ...baseOptions, dryRun: true }, repositoryRoot, {
			runModel: counting
		});

		expect(result.dryRun).toBe(true);
		expect(result.estimate?.units).toBe(2);
		expect(result.costUsd).toBeGreaterThan(0);
		expect(calls).toBe(0);
	});

	test("rejects an invalid language tag", async () => {
		await expect(
			runTranslate({ ...baseOptions, to: "not a tag" }, repositoryRoot, { runModel: fakeModel })
		).rejects.toThrow("Invalid language tag");
	});

	test("rejects an unknown model", async () => {
		await expect(
			runTranslate({ ...baseOptions, model: "gpt-9-ultra" }, repositoryRoot, { runModel: fakeModel })
		).rejects.toThrow("Unknown model id");
	});

	test("rejects unit numbers outside the document", async () => {
		await expect(
			runTranslate({ ...baseOptions, only: [9] }, repositoryRoot, { runModel: fakeModel })
		).rejects.toThrow(ValidationError);
	});

	test("rejects a zero cost limit", async () => {
		await expect(
			runTranslate({ ...baseOptions, maxCost: 0 }, repositoryRoot, { runModel: fakeModel })
		).rejects.toThrow("--max-cost");
	});

	test("accepts a decimal cost limit", async () => {
		const result = await runTranslate({ ...baseOptions, maxCost: 0.25 }, repositoryRoot, {
			runModel: fakeModel
		});

		expect(result.failed).toBe(0);
	});

	test("rejects a non-numeric cost limit", async () => {
		await expect(
			runTranslate({ ...baseOptions, maxCost: "abc" as unknown as number }, repositoryRoot, {
				runModel: fakeModel
			})
		).rejects.toThrow("--max-cost");
	});

	test("rejects a negative concurrency", async () => {
		await expect(
			runTranslate({ ...baseOptions, concurrency: 0 }, repositoryRoot, { runModel: fakeModel })
		).rejects.toThrow("--concurrency");
	});

	test("reports an unknown document", async () => {
		await expect(
			runTranslate({ ...baseOptions, document: "missing" }, repositoryRoot, { runModel: fakeModel })
		).rejects.toThrow(/Document not found/);
	});

	test("writes the custom report path when one is given", async () => {
		const result = await runTranslate(
			{ ...baseOptions, report: "reports/custom-translation.md" },
			repositoryRoot,
			{ runModel: fakeModel }
		);

		expect(result.translated).toBe(2);
	});
});
