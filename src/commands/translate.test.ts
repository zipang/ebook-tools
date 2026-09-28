import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExtractedDocument } from "../extract/writer.ts";
import type { ExtractedDocument } from "../model/document.ts";
import type { ModelRunner } from "../translate/types.ts";
import { runTranslate } from "./translate.ts";

let repositoryRoot = "";

/** Echo the unit back, so the structural check passes and the cache fills. */
const echoModel: ModelRunner = async (input) => ({
	text: input.markdown,
	usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
});

/** Drop every heading, so the structural check fails and the unit is marked failed. */
const structureBreakingModel: ModelRunner = async () => ({
	text: "A bare paragraph with no heading at all.",
	usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
});

/** Report a finish reason of "length", so the unit is billed and then truncated. */
const truncatingModel: ModelRunner = async (input) => ({
	text: `${input.markdown} continued`,
	finishReason: "length",
	usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
});

/** Build a minimal in-memory document with the requested number of units. */
const buildDocument = (unitCount: number): ExtractedDocument => ({
	title: "Sample Book",
	language: "en",
	source: { format: "epub", path: "sources/sample-book.epub", size: 1024 },
	units: Array.from({ length: unitCount }, (_unused, index) => ({
		id: `unit-${String(index + 1).padStart(3, "0")}`,
		title: `Chapter ${index + 1}`,
		source: { sourcePath: "sources/sample-book.epub", spineIndex: index },
		blocks: [],
		markdown: `# Chapter ${index + 1}\n\nBody text of chapter ${index + 1}.\n`
	})),
	assets: [],
	warnings: []
});

/** Write a document project into a fresh temporary repository root. */
const seed = async (unitCount: number): Promise<void> => {
	repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-translate-"));
	await writeExtractedDocument({
		repositoryRoot,
		documentName: "sample-book",
		document: buildDocument(unitCount)
	});
};

const baseOptions = {
	document: "sample-book",
	to: "fr",
	force: true,
	cache: false,
	bestEffort: false
};

beforeEach(async () => {
	await seed(2);
});

afterEach(async () => {
	await rm(repositoryRoot, { recursive: true, force: true });
});

describe("runTranslate", () => {
	test("translates every unit into a sibling project", async () => {
		const result = await runTranslate(baseOptions, repositoryRoot, { runModel: echoModel });

		expect(result.translated).toBe(2);
		expect(result.failed).toBe(0);
		expect(result.outputDir).toContain("sample-book-fr");
	});

	test("writes the report to the path given by the report option", async () => {
		await runTranslate({ ...baseOptions, report: "reports/custom.md" }, repositoryRoot, {
			runModel: echoModel
		});

		const reports = await readdir(join(repositoryRoot, "documents", "sample-book-fr", "reports"));

		expect(reports).toContain("custom.md");
	});

	test("writes the default report when no report path is given", async () => {
		await runTranslate(baseOptions, repositoryRoot, { runModel: echoModel });

		const reports = await readdir(join(repositoryRoot, "documents", "sample-book-fr", "reports"));

		expect(reports).toContain("translation.md");
		expect(reports).not.toContain("custom.md");
	});

	test("keeps the cache of the units that succeeded when another unit fails", async () => {
		const result = await runTranslate({ ...baseOptions, cache: true }, repositoryRoot, {
			runModel: structureBreakingModel
		});

		expect(result.failed).toBe(2);

		const cachePath = join(
			repositoryRoot,
			"documents",
			"sample-book-fr",
			"reports",
			"translation.cache.json"
		);
		const cacheFile = Bun.file(cachePath);

		expect(await cacheFile.exists()).toBe(true);
	});

	test("writes the cache of the units that translated before a later unit failed", async () => {
		let call = 0;
		const flakyModel: ModelRunner = async (input) => {
			call += 1;

			if (call === 1) {
				return {
					text: input.markdown,
					usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
				};
			}

			return {
				text: "A bare paragraph with no heading at all.",
				usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
			};
		};

		const result = await runTranslate({ ...baseOptions, cache: true, concurrency: 1 }, repositoryRoot, {
			runModel: flakyModel
		});

		expect(result.translated).toBe(1);
		expect(result.failed).toBe(1);

		const cache = await Bun.file(
			join(repositoryRoot, "documents", "sample-book-fr", "reports", "translation.cache.json")
		).json();

		expect(Object.keys(cache.entries ?? {}).length).toBe(1);
	});

	test("reports the cost of a truncated unit", async () => {
		const result = await runTranslate(baseOptions, repositoryRoot, { runModel: truncatingModel });

		expect(result.failed).toBe(2);
		expect(result.costUsd).toBeGreaterThan(0);
	});
});
