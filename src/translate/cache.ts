import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TokenUsage } from "./types.ts";

/** Version of the cache file format. */
export const CACHE_VERSION = 1;

/** One cached unit translation. */
export type CacheEntry = {
	unitId: string;
	markdown: string;
	translatedTitle?: string;
	usage: TokenUsage;
	costUsd: number;
	durationMs: number;
	model: string;
};

/** Contents of a cache file. */
export type TranslationCache = {
	version: number;
	promptVersion: string;
	entries: Record<string, CacheEntry>;
};

/** Build the cache key for one unit translation. */
export const cacheKey = (input: {
	model: string;
	to: string;
	promptVersion: string;
	markdown: string;
}): string => {
	const payload = [input.model, input.to, input.promptVersion, input.markdown].join("\n");
	const hasher = new Bun.CryptoHasher("sha256");

	hasher.update(payload);

	return hasher.digest("hex");
};

/** Read the cache file, or an empty cache when it is missing or unreadable. */
export const readCache = async (cachePath: string): Promise<Record<string, CacheEntry>> => {
	const file = Bun.file(cachePath);

	if (!(await file.exists())) {
		return {};
	}

	try {
		const parsed = (await file.json()) as Partial<TranslationCache>;

		if (parsed.version !== CACHE_VERSION || typeof parsed.entries !== "object" || !parsed.entries) {
			return {};
		}

		return parsed.entries;
	} catch {
		return {};
	}
};

/** Write the cache file, creating its directory when needed. */
export const writeCache = async (
	cachePath: string,
	entries: Record<string, CacheEntry>,
	promptVersion: string
): Promise<void> => {
	const payload: TranslationCache = { version: CACHE_VERSION, promptVersion, entries };

	await mkdir(dirname(cachePath), { recursive: true });
	await Bun.write(cachePath, `${JSON.stringify(payload, null, 2)}\n`);
};
