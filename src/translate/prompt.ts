/** Version of the translation prompt. It is part of the cache key. */
export const TRANSLATION_PROMPT_VERSION = "t0002-v1";

/** Input shared by the prompt builders. */
export type PromptInput = {
	title: string;
	markdown: string;
	to: string;
	from: string;
};

/** Language names used in the prompt, with a fallback to the tag itself. */
const LANGUAGE_NAMES: Record<string, string> = {
	de: "German",
	en: "English",
	es: "Spanish",
	fr: "French",
	it: "Italian",
	ja: "Japanese",
	nl: "Dutch",
	pt: "Portuguese",
	ru: "Russian",
	zh: "Chinese"
};

/** Return an English language name for a BCP-47 tag. */
export const languageName = (tag: string): string => {
	const base = tag.toLowerCase().split("-")[0] ?? tag;

	return LANGUAGE_NAMES[base] ?? tag;
};

/** Build the system prompt that fixes the translation contract. */
export const buildSystemPrompt = (input: { to: string; from: string }): string => {
	const target = languageName(input.to);
	const source = languageName(input.from);

	return [
		`You are a professional literary translator. Translate ${source} text into ${target}.`,
		"",
		"Rules:",
		"1. Translate all human-readable prose, headings, list items, table cells, captions, and image alternative text.",
		"2. Keep the Markdown structure identical: the same block types in the same order, the same heading levels, the same list markers and item counts, the same table shape, the same block quotes, and the same horizontal rules.",
		"3. Keep code blocks and inline code unchanged.",
		"4. Keep every link target and every image source exactly as written. Translate only the visible link text and the alternative text.",
		"5. Keep internal links such as /read/unit-002 unchanged, and only use internal links that already appear in the source.",
		"6. Do not add, remove, merge, or split any block.",
		"7. Do not add commentary, notes, or explanations.",
		"8. Output the translated Markdown only. Do not wrap the result in a code fence."
	].join("\n");
};

/** Build the user prompt that carries the unit to translate. */
export const buildUserPrompt = (input: PromptInput): string => {
	return [
		`Translate the following Markdown unit into ${languageName(input.to)}.`,
		"",
		`Source language: ${languageName(input.from)}`,
		`Unit title: ${input.title}`,
		"",
		input.markdown
	].join("\n");
};
