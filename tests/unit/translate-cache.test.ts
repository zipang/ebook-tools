import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CacheEntry, cacheKey, readCache, writeCache } from "../../src/translate/cache.ts";

let directory = "";
let cachePath = "";

const entry: CacheEntry = {
	unitId: "unit-001",
	markdown: "# Chapitre 1\n\nTexte.",
	translatedTitle: "Chapitre 1",
	usage: { noCacheTokens: 100, cacheReadTokens: 0, outputTokens: 20 },
	costUsd: 0.001,
	durationMs: 42,
	model: "deepseek-v4.1-flash"
};

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "ebook-translate-cache-"));
	cachePath = join(directory, "reports", "translation.cache.json");
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("cacheKey", () => {
	test("is stable for the same inputs", () => {
		const input = { model: "deepseek-v4.1-flash", to: "fr", promptVersion: "t0002-v1", markdown: "# A" };

		expect(cacheKey(input)).toBe(cacheKey({ ...input }));
	});

	test("changes with the model", () => {
		const base = { model: "deepseek-v4.1-flash", to: "fr", promptVersion: "t0002-v1", markdown: "# A" };

		expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: "gemini-3-flash" }));
	});

	test("changes with the target language", () => {
		const base = { model: "deepseek-v4.1-flash", to: "fr", promptVersion: "t0002-v1", markdown: "# A" };

		expect(cacheKey(base)).not.toBe(cacheKey({ ...base, to: "de" }));
	});

	test("changes with the prompt version", () => {
		const base = { model: "deepseek-v4.1-flash", to: "fr", promptVersion: "t0002-v1", markdown: "# A" };

		expect(cacheKey(base)).not.toBe(cacheKey({ ...base, promptVersion: "t0002-v2" }));
	});

	test("changes with the source Markdown", () => {
		const base = { model: "deepseek-v4.1-flash", to: "fr", promptVersion: "t0002-v1", markdown: "# A" };

		expect(cacheKey(base)).not.toBe(cacheKey({ ...base, markdown: "# B" }));
	});
});

describe("readCache and writeCache", () => {
	test("returns an empty map when the file does not exist", async () => {
		expect(await readCache(cachePath)).toEqual({});
	});

	test("returns an empty map when the file is corrupted", async () => {
		await Bun.write(cachePath, "not json at all");

		expect(await readCache(cachePath)).toEqual({});
	});

	test("round-trips an entry", async () => {
		await writeCache(
			cachePath,
			{
				[cacheKey({ model: entry.model, to: "fr", promptVersion: "t0002-v1", markdown: "# A" })]:
					entry
			},
			"t0002-v1"
		);

		const cache = await readCache(cachePath);

		expect(Object.values(cache)).toEqual([entry]);
	});

	test("creates the reports directory when writing", async () => {
		await writeCache(cachePath, { k: entry }, "t0002-v1");

		expect(await Bun.file(cachePath).exists()).toBe(true);
	});
});
