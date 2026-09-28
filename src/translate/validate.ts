import { type ChildNode, type Element, isTag } from "domhandler";
import { DomUtils, parseDocument } from "htmlparser2";
import { AppError } from "../shared/errors.ts";
import type { ValidationIssue, ValidationOutcome } from "./types.ts";

/** One structural block found in a Markdown document. */
export type SkeletonBlock = {
	kind: "heading" | "paragraph" | "list" | "blockquote" | "table" | "code" | "thematic-break";
	level?: number;
	ordered?: boolean;
	itemCount?: number;
	rows?: number;
	columns?: number;
	language?: string | null;
};

/** The structure of a Markdown document. */
export type StructureSkeleton = {
	blocks: SkeletonBlock[];
	links: string[];
	images: string[];
};

const DEFAULT_LENGTH_BAND = { min: 0.4, max: 2.5 };

/** Return the child nodes of a node, or an empty list for leaf nodes. */
const childrenOf = (node: ChildNode): ChildNode[] =>
	"children" in node && Array.isArray(node.children) ? node.children : [];

/** Find the first direct child element with a tag name. */
const findChild = (node: ChildNode, name: string): Element | undefined => {
	for (const child of childrenOf(node)) {
		if (isTag(child) && child.name === name) {
			return child;
		}
	}

	return undefined;
};

/** Return every direct child element with a tag name. */
const childrenNamed = (node: ChildNode, name: string): ChildNode[] =>
	childrenOf(node).filter((child) => isTag(child) && child.name === name);

/** Return the code block language declared by a fenced block. */
const codeLanguage = (pre: Element): string | null => {
	const code = findChild(pre, "code");
	const className = code?.attribs.class ?? pre.attribs.class ?? "";
	const match = /language-([\w+-]+)/.exec(className);

	return match?.[1] ?? null;
};

/** Count the rows and the columns of a table. */
const tableShape = (table: Element): { rows: number; columns: number } => {
	let rows = 0;
	let columns = 0;

	const walkRows = (node: ChildNode): void => {
		for (const child of childrenOf(node)) {
			if (!isTag(child)) {
				continue;
			}

			if (child.name === "tr") {
				rows += 1;
				columns = Math.max(
					columns,
					childrenNamed(child, "td").length + childrenNamed(child, "th").length
				);
				continue;
			}

			walkRows(child);
		}
	};

	walkRows(table);

	return { rows, columns };
};

/** Build the structural skeleton of a Markdown document. */
export const extractStructure = (markdown: string): StructureSkeleton => {
	const blocks: SkeletonBlock[] = [];
	const links: string[] = [];
	const images: string[] = [];

	let html: string;

	try {
		html = Bun.markdown.html(markdown);
	} catch (error) {
		throw new AppError("markdown-parse-error", `Unable to render Markdown: ${String(error)}`);
	}

	const document = parseDocument(html);

	const collect = (node: Element): void => {
		const name = node.name.toLowerCase();

		if (name === "a" && typeof node.attribs.href === "string") {
			links.push(node.attribs.href);
		}

		if (name === "img" && typeof node.attribs.src === "string") {
			images.push(node.attribs.src);
		}

		if (/^h[1-6]$/.test(name)) {
			blocks.push({ kind: "heading", level: Number(name.slice(1)) });
		} else if (name === "p") {
			blocks.push({ kind: "paragraph" });
		} else if (name === "ul" || name === "ol") {
			blocks.push({
				kind: "list",
				ordered: name === "ol",
				itemCount: childrenNamed(node, "li").length
			});
		} else if (name === "blockquote") {
			blocks.push({ kind: "blockquote" });
		} else if (name === "table") {
			const { rows, columns } = tableShape(node);
			blocks.push({ kind: "table", rows, columns });
		} else if (name === "pre") {
			blocks.push({ kind: "code", language: codeLanguage(node) });
		} else if (name === "hr") {
			blocks.push({ kind: "thematic-break" });
		}
	};

	const walk = (node: ChildNode): void => {
		if (isTag(node)) {
			collect(node);
		}

		for (const child of childrenOf(node)) {
			walk(child);
		}
	};

	walk(document);

	return { blocks, links, images };
};

/**
 * Describe a block for a validation message, or the end of the document.
 *
 * The message tells a reviewer which block moved, so it carries the whole
 * block shape rather than a label. A missing block means one document has
 * more blocks than the other, and the message says so.
 */
const describeBlock = (block: SkeletonBlock | undefined): string =>
	block ? JSON.stringify(block) : "nothing (end of document)";

/** Compare two skeletons and collect structural issues. */
const compareBlocks = (source: SkeletonBlock[], translated: SkeletonBlock[]): ValidationIssue[] => {
	const issues: ValidationIssue[] = [];
	const length = Math.max(source.length, translated.length);

	for (let index = 0; index < length; index += 1) {
		const expected = source[index];
		const actual = translated[index];
		const expectedKey = JSON.stringify(expected);
		const actualKey = JSON.stringify(actual);

		if (expectedKey !== actualKey) {
			issues.push({
				kind: "structure",
				message: `Block ${index + 1} changed. Expected ${describeBlock(expected)} but found ${describeBlock(actual)}.`
			});

			if (issues.length >= 5) {
				issues.push({ kind: "structure", message: "More structural differences were omitted." });

				break;
			}
		}
	}

	return issues;
};

/** Compare two ordered lists of targets. */
const compareTargets = (
	source: string[],
	translated: string[],
	kind: "link" | "image",
	label: string
): ValidationIssue[] => {
	const issues: ValidationIssue[] = [];
	const length = Math.max(source.length, translated.length);

	for (let index = 0; index < length; index += 1) {
		if (source[index] !== translated[index]) {
			issues.push({
				kind,
				message: `${label} ${index + 1} changed. Expected "${source[index] ?? "nothing"}" but found "${translated[index] ?? "nothing"}".`
			});
		}
	}

	return issues;
};

/** Find internal unit links that point outside the output project. */
const checkInternalLinks = (links: string[], unitIds: Set<string>): ValidationIssue[] => {
	const issues: ValidationIssue[] = [];

	for (const href of links) {
		const match = /\/read\/(unit-[a-z0-9-]+)/.exec(href);

		if (match?.[1] && !unitIds.has(match[1])) {
			issues.push({
				kind: "internal-link",
				message: `Internal link "${href}" points to unknown unit "${match[1]}".`
			});
		}
	}

	return issues;
};

/** Check that a translated unit keeps the structure of its source unit. */
export const validateTranslation = (input: {
	sourceMarkdown: string;
	translatedMarkdown: string;
	unitIds: Set<string>;
	lengthBand?: { min: number; max: number };
}): ValidationOutcome => {
	const source = extractStructure(input.sourceMarkdown);
	const translated = extractStructure(input.translatedMarkdown);

	const issues: ValidationIssue[] = [
		...compareBlocks(source.blocks, translated.blocks),
		...compareTargets(source.links, translated.links, "link", "Link target"),
		...compareTargets(source.images, translated.images, "image", "Image source"),
		...checkInternalLinks(translated.links, input.unitIds)
	];

	const warnings: string[] = [];
	const band = input.lengthBand ?? DEFAULT_LENGTH_BAND;
	const ratio = input.translatedMarkdown.length / Math.max(input.sourceMarkdown.length, 1);

	if (ratio < band.min || ratio > band.max) {
		warnings.push(
			`Translated length ratio is ${ratio.toFixed(2)} and leaves the band ${band.min} to ${band.max}.`
		);
	}

	return { ok: issues.length === 0, issues, warnings };
};

/** Remove a code fence that wraps the whole model answer. */
export const stripOuterCodeFence = (markdown: string): string => {
	const trimmed = markdown.trim();
	const match = /^```[\w+-]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);

	return match?.[1] === undefined ? markdown : match[1];
};

/** Return the text of the first heading, or null when the document has none. */
export const extractFirstHeading = (markdown: string): string | null => {
	let html: string;

	try {
		html = Bun.markdown.html(markdown);
	} catch {
		return null;
	}

	for (const node of parseDocument(html).children) {
		if (!isTag(node)) {
			continue;
		}

		const name = node.name.toLowerCase();

		if (/^h[1-6]$/.test(name)) {
			return DomUtils.textContent(node).trim();
		}
	}

	return null;
};
