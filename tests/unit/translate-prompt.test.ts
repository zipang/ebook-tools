import { describe, expect, test } from "bun:test";
import {
	buildSystemPrompt,
	buildUserPrompt,
	TRANSLATION_PROMPT_VERSION
} from "../../src/translate/prompt.ts";

describe("buildSystemPrompt", () => {
	test("names the target language and the source language", () => {
		const prompt = buildSystemPrompt({ to: "fr", from: "en" });

		expect(prompt).toContain("French");
		expect(prompt).toContain("English");
	});

	test("forbids changing link targets and image sources", () => {
		const prompt = buildSystemPrompt({ to: "fr", from: "en" });

		expect(prompt).toMatch(/link target/i);
		expect(prompt).toMatch(/image source/i);
	});

	test("requires Markdown output without a code fence", () => {
		const prompt = buildSystemPrompt({ to: "fr", from: "en" });

		expect(prompt).toMatch(/only/i);
		expect(prompt).toMatch(/code fence/i);
	});
});

describe("buildUserPrompt", () => {
	test("includes the unit title and the Markdown body", () => {
		const prompt = buildUserPrompt({
			title: "Chapter 1",
			markdown: "# Chapter 1\n\nBody text.",
			to: "fr",
			from: "en"
		});

		expect(prompt).toContain("Chapter 1");
		expect(prompt).toContain("# Chapter 1");
		expect(prompt).toContain("Body text.");
	});
});

describe("TRANSLATION_PROMPT_VERSION", () => {
	test("is a stable non-empty identifier", () => {
		expect(TRANSLATION_PROMPT_VERSION).toMatch(/^t0002-v\d+$/);
	});
});
