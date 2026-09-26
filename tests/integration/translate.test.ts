import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuild } from "../../src/commands/build.ts";
import { runExtract } from "../../src/commands/extract.ts";
import { translateDocument } from "../../src/translate/translate.ts";
import type { ModelRunner } from "../../src/translate/types.ts";
import { makeSpineEpubFixture, PIXEL_PNG } from "../fixtures/epub/make-fixture.ts";

let repositoryRoot = "";

/** A fake model that appends a suffix to visible text and keeps the structure. */
const createFakeModel = () => {
	const calls: string[] = [];

	const run: ModelRunner = async (input) => {
		calls.push(input.markdown);

		return {
			text: input.markdown,
			usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
		};
	};

	return { run, calls };
};

const readManifest = async (name: string) =>
	(await Bun.file(join(repositoryRoot, "documents", name, "manifest.json")).json()) as {
		id: string;
		title: string;
		language: string;
		direction: string;
		units: { id: string; title: string; path: string }[];
		assets: { path: string }[];
	};

beforeEach(async () => {
	repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-translate-"));
	await Bun.write(
		join(repositoryRoot, "sources", "library", "book.epub"),
		makeSpineEpubFixture(
			[
				{
					href: "a.xhtml",
					body: '<h1>Alpha</h1><p>First unit with an image.</p><p><img src="../images/pixel.png" alt="Alpha"/></p>'
				},
				{ href: "b.xhtml", body: "<h1>Beta</h1><p>Second unit.</p>" },
				{ href: "c.xhtml", body: "<h1>Gamma</h1><p>Third unit.</p>" }
			],
			{ "pixel.png": PIXEL_PNG }
		)
	);
	await runExtract({ input: "sources/library/book.epub" }, repositoryRoot);
});

afterEach(async () => {
	await rm(repositoryRoot, { recursive: true, force: true });
});

describe("translateDocument", () => {
	test("writes a sibling project with translated units and a valid manifest", async () => {
		const fake = createFakeModel();

		const result = await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 2,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: fake.run }
		);

		expect(result.translated).toBe(3);
		expect(result.failed).toBe(0);

		const source = await readManifest("book");
		const translated = await readManifest("book-fr");

		expect(translated.id).toBe("book-fr");
		expect(translated.language).toBe("fr");
		expect(translated.direction).toBe("ltr");
		expect(translated.units.map((unit) => unit.id)).toEqual(source.units.map((unit) => unit.id));
		expect(translated.units.map((unit) => unit.path)).toEqual(source.units.map((unit) => unit.path));
		expect(translated.units).toHaveLength(3);
	});

	test("copies the assets of the source project", async () => {
		const fake = createFakeModel();

		await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 2,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: fake.run }
		);

		const imagePath = join(repositoryRoot, "documents", "book-fr", "assets", "images", "pixel.png");

		expect(await Bun.file(imagePath).exists()).toBe(true);
	});

	test("leaves the source project unchanged", async () => {
		const fake = createFakeModel();
		const before = await readManifest("book");

		await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 2,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: fake.run }
		);

		expect(await readManifest("book")).toEqual(before);
	});

	test("reuses the cache on a second run", async () => {
		const first = createFakeModel();
		const options = {
			document: "book",
			to: "fr",
			model: "deepseek-v4.1-flash",
			outDocument: "book-fr",
			concurrency: 2,
			force: false,
			cache: true,
			bestEffort: false
		};

		await translateDocument(options, repositoryRoot, { runModel: first.run });

		const second = createFakeModel();
		const result = await translateDocument({ ...options, force: true }, repositoryRoot, {
			runModel: second.run
		});

		expect(second.calls).toHaveLength(0);
		expect(result.cached).toBe(3);
		expect(result.translated).toBe(0);
	});

	test("marks a unit as failed when the structure breaks and writes no chapter", async () => {
		const broken: ModelRunner = async (input) => ({
			text: input.markdown.replace(/^# .*/m, ""),
			usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
		});

		const result = await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 1,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: broken }
		);

		expect(result.failed).toBe(3);
		const chapters = join(repositoryRoot, "documents", "book-fr", "chapters");
		expect(await Bun.file(join(chapters, "001-alpha.md")).exists()).toBe(false);
	});

	test("copies failed units from the source in best-effort mode", async () => {
		const broken: ModelRunner = async (input) => ({
			text: input.markdown.replace(/^# .*/m, ""),
			usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
		});

		const result = await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 1,
				force: false,
				cache: true,
				bestEffort: true
			},
			repositoryRoot,
			{ runModel: broken }
		);

		expect(result.failed).toBe(3);
		const manifest = await readManifest("book-fr");
		expect(manifest.units).toHaveLength(3);
		const chapter = await Bun.file(
			join(repositoryRoot, "documents", "book-fr", manifest.units[0]?.path ?? "")
		).text();
		expect(chapter).toContain("Alpha");
	});

	test("refuses a non-empty output project without force", async () => {
		const fake = createFakeModel();
		const options = {
			document: "book",
			to: "fr",
			model: "deepseek-v4.1-flash",
			outDocument: "book-fr",
			concurrency: 2,
			force: false,
			cache: true,
			bestEffort: false
		};

		await translateDocument(options, repositoryRoot, { runModel: fake.run });

		await expect(translateDocument(options, repositoryRoot, { runModel: fake.run })).rejects.toThrow(
			/--force/
		);
	});

	test("translates only the selected units and copies the rest", async () => {
		const fake = createFakeModel();

		const result = await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 1,
				only: [2],
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: fake.run }
		);

		expect(fake.calls).toHaveLength(1);
		expect(result.translated).toBe(1);
		expect(result.skipped).toBe(2);
		expect((await readManifest("book-fr")).units).toHaveLength(3);
	});

	test("stops the run when the cost limit is reached", async () => {
		const fake = createFakeModel();

		const result = await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 1,
				force: false,
				cache: true,
				bestEffort: true,
				maxCostUsd: 0
			},
			repositoryRoot,
			{ runModel: fake.run }
		);

		expect(result.skipped).toBe(3);
		expect(result.translated).toBe(0);
	});

	test("calls the model again when the cache is disabled", async () => {
		const fake = createFakeModel();
		const options = {
			document: "book",
			to: "fr",
			model: "deepseek-v4.1-flash",
			outDocument: "book-fr",
			concurrency: 2,
			force: false,
			cache: false,
			bestEffort: false
		};

		await translateDocument(options, repositoryRoot, { runModel: fake.run });
		const second = createFakeModel();
		await translateDocument({ ...options, force: true }, repositoryRoot, { runModel: second.run });

		expect(second.calls).toHaveLength(3);
	});

	test("reports a truncated answer as a truncation, not a structure failure", async () => {
		const truncated: ModelRunner = async (input) => ({
			text: input.markdown.slice(0, Math.floor(input.markdown.length / 2)),
			usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 },
			finishReason: "length"
		});

		const result = await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 1,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: truncated }
		);

		expect(result.failed).toBe(3);
		expect(result.units[0]?.error).toContain("truncated");
		expect(result.units[0]?.error).not.toContain("Structure check");
	});

	test("writes the translation reports", async () => {
		const fake = createFakeModel();

		await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 2,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: fake.run }
		);

		const reports = join(repositoryRoot, "documents", "book-fr", "reports");
		const markdown = await Bun.file(join(reports, "translation.md")).text();
		const json = (await Bun.file(join(reports, "translation.json")).json()) as {
			totals: { units: number };
			units: { unitId: string }[];
		};

		expect(markdown).toContain("# Translation report");
		expect(markdown).toContain("| Units | 3 |");
		expect(json.totals.units).toBe(3);
		expect(json.units.map((unit) => unit.unitId)).toEqual(["unit-001", "unit-002", "unit-003"]);
	});

	test("writes the report even when the strict policy fails", async () => {
		const broken: ModelRunner = async (input) => ({
			text: input.markdown.replace(/^# .*/m, ""),
			usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 }
		});

		await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 1,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: broken }
		);

		const markdown = await Bun.file(
			join(repositoryRoot, "documents", "book-fr", "reports", "translation.md")
		).text();

		expect(markdown).toContain("## Failures");
		expect(markdown).toContain("Structure check failed");
	});

	test("serves and builds the translated project without changes", async () => {
		const fake = createFakeModel();

		await translateDocument(
			{
				document: "book",
				to: "fr",
				model: "deepseek-v4.1-flash",
				outDocument: "book-fr",
				concurrency: 2,
				force: false,
				cache: true,
				bestEffort: false
			},
			repositoryRoot,
			{ runModel: fake.run }
		);

		const html = await runBuild({
			repositoryRoot,
			documentName: "book-fr",
			format: "html",
			out: "generated"
		});
		const indexHtml = await Bun.file(join(html.outputDir, "index.html")).text();

		expect(indexHtml).toContain('lang="fr"');
	});
});
