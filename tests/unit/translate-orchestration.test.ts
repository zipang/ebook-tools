import { describe, expect, test } from "bun:test";
import { ValidationError } from "../../src/shared/errors.ts";
import {
	defaultOutDocument,
	isRetryableError,
	normalizeLanguageTag,
	runPool,
	withRetry
} from "../../src/translate/translate.ts";

describe("normalizeLanguageTag", () => {
	test("keeps a simple tag", () => {
		expect(normalizeLanguageTag("fr")).toBe("fr");
	});

	test("canonicalizes a regional tag", () => {
		expect(normalizeLanguageTag("fr-ca")).toBe("fr-ca");
	});

	test("accepts an upper-case tag", () => {
		expect(normalizeLanguageTag("FR")).toBe("fr");
	});

	test("rejects an empty tag", () => {
		expect(() => normalizeLanguageTag("  ")).toThrow(ValidationError);
	});

	test("rejects a malformed tag", () => {
		expect(() => normalizeLanguageTag("not a tag")).toThrow("Invalid language tag");
	});
});

describe("defaultOutDocument", () => {
	test("suffixes the document name with the language", () => {
		expect(defaultOutDocument("book", "fr")).toBe("book-fr");
	});

	test("keeps the regional part", () => {
		expect(defaultOutDocument("book", "fr-ca")).toBe("book-fr-ca");
	});
});

describe("runPool", () => {
	test("keeps the input order", async () => {
		const results = await runPool([30, 10, 20], 2, async (delay) => {
			await Bun.sleep(delay);

			return delay;
		});

		expect(results).toEqual([30, 10, 20]);
	});

	test("never exceeds the concurrency limit", async () => {
		let active = 0;
		let peak = 0;

		await runPool([1, 2, 3, 4, 5, 6], 2, async () => {
			active += 1;
			peak = Math.max(peak, active);
			await Bun.sleep(5);
			active -= 1;

			return null;
		});

		expect(peak).toBeLessThanOrEqual(2);
	});

	test("handles an empty list", async () => {
		expect(await runPool([], 4, async () => null)).toEqual([]);
	});
});

describe("isRetryableError", () => {
	test("treats a network TypeError as retryable", () => {
		expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
	});

	test("treats rate limits and server errors as retryable", () => {
		expect(isRetryableError({ statusCode: 429 })).toBe(true);
		expect(isRetryableError({ statusCode: 503 })).toBe(true);
	});

	test("treats a client error as final", () => {
		expect(isRetryableError({ statusCode: 400 })).toBe(false);
	});

	test("treats an unknown error as final", () => {
		expect(isRetryableError(new Error("boom"))).toBe(false);
	});
});

describe("withRetry", () => {
	test("returns the first success", async () => {
		expect(await withRetry(async () => "ok")).toBe("ok");
	});

	test("retries a retryable failure and then succeeds", async () => {
		let attempts = 0;

		const value = await withRetry(async () => {
			attempts += 1;

			if (attempts < 3) {
				throw new TypeError("fetch failed");
			}

			return attempts;
		});

		expect(value).toBe(3);
	});

	test("does not retry a final failure", async () => {
		let attempts = 0;

		await expect(
			withRetry(async () => {
				attempts += 1;

				throw new Error("boom");
			})
		).rejects.toThrow("boom");

		expect(attempts).toBe(1);
	});

	test("gives up after the attempt limit", async () => {
		let attempts = 0;

		await expect(
			withRetry(async () => {
				attempts += 1;

				throw new TypeError("fetch failed");
			})
		).rejects.toThrow("fetch failed");

		expect(attempts).toBe(3);
	});
});
