export type SourceFormat = "epub" | "pdf";

export type WarningCode =
	| "encrypted-source"
	| "malformed-source"
	| "missing-text"
	| "unsupported-structure"
	| "unresolved-resource"
	| "low-confidence"
	| "dropped-content"
	| "decorative-image"
	| "ambiguous-structure"
	| "name-collision"
	| "write-failed";

export type SourceLocation = {
	sourcePath: string;
	page?: number;
	spineIndex?: number;
	selector?: string;
	confidence?: number;
};

export type TextInline = {
	kind: "text";
	text: string;
};

export type StyleInline = {
	kind: "emphasis";
	style: "emphasis" | "strong";
	children: Inline[];
};

export type LinkInline = {
	kind: "link";
	href: string;
	children: Inline[];
};

export type CodeInline = {
	kind: "code";
	text: string;
};

export type ImageInline = {
	kind: "image";
	assetId: string;
	altText?: string;
	title?: string;
};

export type Inline = TextInline | StyleInline | LinkInline | CodeInline | ImageInline;

export type ParagraphBlock = {
	kind: "paragraph";
	children: Inline[];
};

export type HeadingBlock = {
	kind: "heading";
	level: 1 | 2 | 3 | 4 | 5 | 6;
	children: Inline[];
};

export type ListItem = {
	blocks: Block[];
};

export type ListBlock = {
	kind: "list";
	ordered: boolean;
	items: ListItem[];
};

export type BlockquoteBlock = {
	kind: "blockquote";
	blocks: Block[];
};

export type CodeBlock = {
	kind: "code";
	text: string;
	language?: string;
};

export type TableBlock = {
	kind: "table";
	headers: string[];
	rows: string[][];
};

export type ThematicBreakBlock = {
	kind: "thematic-break";
};

export type Block =
	| ParagraphBlock
	| HeadingBlock
	| ListBlock
	| BlockquoteBlock
	| CodeBlock
	| TableBlock
	| ThematicBreakBlock;

export type DocumentUnit = {
	id: string;
	title: string;
	source: SourceLocation;
	blocks: Block[];
	/**
	 * Final Markdown produced directly by a source adapter. When present, the
	 * serializer writes this value instead of the block list. PDF extraction
	 * leaves it undefined and keeps the semantic blocks.
	 */
	markdown?: string;
};

export type ImageAsset = {
	id: string;
	path: string;
	bytes: Uint8Array;
	mimeType: string;
	altText?: string;
	width?: number;
	height?: number;
	source?: SourceLocation;
};

export type ExtractionWarning = {
	code: WarningCode;
	message: string;
	severity: "warning" | "error";
	location?: SourceLocation;
};

export type SourceMetadata = {
	format: SourceFormat;
	path: string;
	size: number;
};

export type ExtractedDocument = {
	title: string;
	language: string;
	source: SourceMetadata;
	units: DocumentUnit[];
	assets: ImageAsset[];
	warnings: ExtractionWarning[];
};
