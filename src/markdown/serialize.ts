import type { Block, DocumentUnit, ExtractedDocument, Inline, ListItem } from "../model/document.ts";

export type SerializeOptions = {
	assetPaths?: ReadonlyMap<string, string>;
};

/** Escape Markdown special characters in a text string. */
const escapeText = (text: string): string => {
	return text.replace(/[\\`*_[\]<>]/g, "\\$&");
};

/** Return the relative Markdown path for an asset identifier. */
const getAssetPath = (assetId: string, options: SerializeOptions): string => {
	const path = options.assetPaths?.get(assetId) ?? `assets/images/${assetId}`;
	return path.startsWith("../") ? path : `../${path}`;
};

/** Serialize one inline node to Markdown. */
const serializeInline = (inline: Inline, options: SerializeOptions): string => {
	switch (inline.kind) {
		case "text":
			return escapeText(inline.text);
		case "emphasis": {
			const text = inline.children.map((child) => serializeInline(child, options)).join("");
			return inline.style === "strong" ? `**${text}**` : `*${text}*`;
		}
		case "link": {
			const text = inline.children.map((child) => serializeInline(child, options)).join("");
			return `[${text}](${inline.href})`;
		}
		case "code":
			return `\`${inline.text.replaceAll("`", "\\`")}\``;
		case "image": {
			const altText = inline.altText ?? "";
			const title = inline.title === undefined ? "" : ` "${inline.title.replaceAll('"', '\\"')}"`;
			return `![${altText}](${getAssetPath(inline.assetId, options)}${title})`;
		}
	}
};

/** Add a prefix to every line of a text block. */
const indentLines = (text: string, prefix: string): string => {
	return text
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
};

/** Serialize one list item with its marker and indentation. */
const serializeListItem = (
	item: ListItem,
	ordered: boolean,
	index: number,
	options: SerializeOptions
): string => {
	const marker = ordered ? `${index + 1}.` : "-";
	const content = item.blocks.map((block) => serializeBlock(block, options)).join("\n\n");
	return `${marker} ${content.replaceAll("\n", `\n${" ".repeat(marker.length + 1)}`)}`;
};

/** Serialize one block node to Markdown. */
const serializeBlock = (block: Block, options: SerializeOptions): string => {
	switch (block.kind) {
		case "paragraph":
			return block.children.map((child) => serializeInline(child, options)).join("");
		case "heading":
			return `${"#".repeat(block.level)} ${block.children.map((child) => serializeInline(child, options)).join("")}`;
		case "list":
			return block.items
				.map((item, index) => serializeListItem(item, block.ordered, index, options))
				.join("\n");
		case "blockquote":
			return indentLines(
				block.blocks.map((child) => serializeBlock(child, options)).join("\n\n"),
				"> "
			);
		case "code": {
			const language = block.language ?? "";
			return `\`\`\`${language}\n${block.text}\n\`\`\``;
		}
		case "table": {
			const header = `| ${block.headers.join(" | ")} |`;
			const separator = `| ${block.headers.map(() => "---").join(" | ")} |`;
			const rows = block.rows.map((row) => `| ${row.join(" | ")} |`);
			return [header, separator, ...rows].join("\n");
		}
		case "thematic-break":
			return "---";
	}
};

/** Serialize one document unit to Markdown. */
export const serializeDocumentUnit = (unit: DocumentUnit, options: SerializeOptions = {}): string => {
	if (unit.markdown !== undefined) {
		return unit.markdown;
	}

	return unit.blocks.map((block) => serializeBlock(block, options)).join("\n\n");
};

/** Serialize all units in a document to Markdown. */
export const serializeDocument = (document: ExtractedDocument, options: SerializeOptions = {}): string => {
	return document.units.map((unit) => serializeDocumentUnit(unit, options)).join("\n\n---\n\n");
};
