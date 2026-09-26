import { describe, expect, test } from "bun:test";
import { extractStructure, stripOuterCodeFence, validateTranslation } from "../../src/translate/validate.ts";

const SOURCE = [
	"# Chapter 1",
	"",
	"Read [the next part](/read/unit-002) and see ![a figure](../assets/images/figure-001.png).",
	"",
	"- first item",
	"- second item",
	"",
	"| Name | Meaning |",
	"| --- | --- |",
	"| home | start page |",
	"| about | history |",
	"",
	"```ts",
	"const answer = 42;",
	"```",
	"",
	"> A quoted line.",
	"",
	"---"
].join("\n");

const TRANSLATION = [
	"# Chapitre 1",
	"",
	"Lisez [la partie suivante](/read/unit-002) et voyez ![une figure](../assets/images/figure-001.png).",
	"",
	"- premier élément",
	"- deuxième élément",
	"",
	"| Nom | Sens |",
	"| --- | --- |",
	"| accueil | page de départ |",
	"| à propos | historique |",
	"",
	"```ts",
	"const answer = 42;",
	"```",
	"",
	"> Une ligne citée.",
	"",
	"---"
].join("\n");

const UNIT_IDS = new Set(["unit-001", "unit-002", "unit-003"]);

const validate = (translatedMarkdown: string, sourceMarkdown = SOURCE) =>
	validateTranslation({
		sourceMarkdown,
		translatedMarkdown,
		unitIds: UNIT_IDS
	});

describe("extractStructure", () => {
	test("records heading levels, list shape, table shape, and code language", () => {
		const structure = extractStructure(SOURCE);

		expect(structure.blocks).toEqual([
			{ kind: "heading", level: 1 },
			{ kind: "paragraph" },
			{ kind: "list", ordered: false, itemCount: 2 },
			{ kind: "table", rows: 3, columns: 2 },
			{ kind: "code", language: "ts" },
			{ kind: "blockquote" },
			{ kind: "paragraph" },
			{ kind: "thematic-break" }
		]);
	});

	test("collects link targets and image sources in document order", () => {
		const structure = extractStructure(SOURCE);

		expect(structure.links).toEqual(["/read/unit-002"]);
		expect(structure.images).toEqual(["../assets/images/figure-001.png"]);
	});

	test("distinguishes ordered from unordered lists", () => {
		expect(extractStructure("1. one\n2. two\n").blocks).toEqual([
			{ kind: "list", ordered: true, itemCount: 2 }
		]);
	});
});

describe("validateTranslation", () => {
	test("accepts a faithful translation", () => {
		const outcome = validate(TRANSLATION);

		expect(outcome.ok).toBe(true);
		expect(outcome.issues).toEqual([]);
	});

	test("rejects a rewritten link target", () => {
		const outcome = validate(TRANSLATION.replace("/read/unit-002", "/read/unit-009"));

		expect(outcome.ok).toBe(false);
		expect(outcome.issues.some((issue) => issue.kind === "link")).toBe(true);
	});

	test("rejects a rewritten image source", () => {
		const outcome = validate(TRANSLATION.replace("figure-001.png", "figure-002.png"));

		expect(outcome.ok).toBe(false);
		expect(outcome.issues.some((issue) => issue.kind === "image")).toBe(true);
	});

	test("rejects a dropped heading", () => {
		const outcome = validate(TRANSLATION.replace("# Chapitre 1\n\n", ""));

		expect(outcome.ok).toBe(false);
		expect(outcome.issues.some((issue) => issue.kind === "structure")).toBe(true);
	});

	test("rejects a list that lost an item", () => {
		const outcome = validate(TRANSLATION.replace("- deuxième élément\n", ""));

		expect(outcome.ok).toBe(false);
		expect(outcome.issues.some((issue) => issue.kind === "structure")).toBe(true);
	});

	test("rejects a table that lost a row", () => {
		const outcome = validate(TRANSLATION.replace("| à propos | historique |\n", ""));

		expect(outcome.ok).toBe(false);
		expect(outcome.issues.some((issue) => issue.kind === "structure")).toBe(true);
	});

	test("rejects a changed code block language", () => {
		const outcome = validate(TRANSLATION.replace("```ts", "```js"));

		expect(outcome.ok).toBe(false);
		expect(outcome.issues.some((issue) => issue.kind === "structure")).toBe(true);
	});

	test("rejects an internal link to a unit outside the project", () => {
		const outcome = validate(TRANSLATION.replace("/read/unit-002", "/read/unit-777"));

		expect(outcome.ok).toBe(false);
		expect(outcome.issues.some((issue) => issue.kind === "internal-link")).toBe(true);
	});

	test("warns without failing when the length ratio leaves the band", () => {
		const outcome = validate(TRANSLATION.replace("Une ligne citée.", "U".repeat(400)));

		expect(outcome.ok).toBe(true);
		expect(outcome.warnings.length).toBeGreaterThan(0);
		expect(outcome.warnings.join(" ")).toContain("length ratio");
	});
});

describe("stripOuterCodeFence", () => {
	test("removes a wrapping code fence", () => {
		expect(stripOuterCodeFence("```markdown\n# Titre\n\nTexte.\n```")).toBe("# Titre\n\nTexte.");
	});

	test("leaves unwrapped Markdown unchanged", () => {
		expect(stripOuterCodeFence("# Titre\n\nTexte.")).toBe("# Titre\n\nTexte.");
	});

	test("leaves inner code blocks untouched", () => {
		const markdown = "Texte.\n\n```ts\nconst a = 1;\n```";

		expect(stripOuterCodeFence(markdown)).toBe(markdown);
	});
});
