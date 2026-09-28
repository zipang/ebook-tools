import { PDFParse } from "pdf-parse";
import type {
	Block,
	DocumentUnit,
	ExtractedDocument,
	ExtractionWarning,
	ImageAsset,
	ImageInline,
	SourceLocation
} from "../model/document.ts";
import { nextUnitId } from "../model/project.ts";
import { AppError } from "../shared/errors.ts";
import { detectImageFormat } from "../shared/image.ts";
import { slugifyDocumentName } from "../shared/paths.ts";
import type { ExtractionInput } from "./common.ts";

type PageBlock = {
	page: number;
	block: Block;
};

/** Check whether a value is a non-null object. */
const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

/** Return the PDF title from the document information. */
const getPdfTitle = (value: unknown, fallback: string): string => {
	if (!isRecord(value)) {
		return fallback;
	}
	const title = value.Title;
	return typeof title === "string" && title.trim().length > 0 ? title.trim() : fallback;
};

/** Normalize the whitespace of one text line. */
const normalizeLine = (line: string): string => {
	return line
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
};

/** Check whether a text line looks like a section heading. */
const isHeadingLine = (line: string): boolean => {
	if (line.length === 0 || line.length > 100) {
		return false;
	}
	if (
		/^(chapter|part|section|appendix|prologue|epilogue|introduction|conclusion|contents|foreword|afterword)\b/i.test(
			line
		)
	) {
		return true;
	}
	return /^\d+(?:\.\d+)*[.)]?\s+[A-Z]/.test(line) || (line === line.toUpperCase() && /[A-Z]/.test(line));
};

/** Create a source location for one PDF page. */
const createLocation = (sourcePath: string, page: number, confidence?: number): SourceLocation => {
	const location: SourceLocation = { sourcePath, page };
	if (confidence !== undefined) {
		location.confidence = confidence;
	}
	return location;
};

/** Create an image asset from extracted PDF image data. */
const createImageAsset = (
	bytes: Uint8Array,
	name: string,
	page: number,
	sourcePath: string,
	index: number,
	width?: number,
	height?: number
): ImageAsset | undefined => {
	const format = detectImageFormat(bytes);
	if (format === undefined) {
		return undefined;
	}
	const baseName = slugifyDocumentName(name.replace(/\.[^.]+$/, "")) || "image";
	const asset: ImageAsset = {
		id: `asset-${String(index + 1).padStart(3, "0")}`,
		path: `assets/images/${baseName}-${String(index + 1).padStart(3, "0")}${format.extension}`,
		bytes,
		mimeType: format.mimeType,
		source: createLocation(sourcePath, page)
	};
	if (width !== undefined) {
		asset.width = width;
	}
	if (height !== undefined) {
		asset.height = height;
	}
	return asset;
};

/** Convert the text of one page into paragraph and heading blocks. */
const createTextBlocks = (pageText: string, page: number): PageBlock[] => {
	const blocks: PageBlock[] = [];
	for (const rawLine of pageText.split(/\r?\n/)) {
		const line = normalizeLine(rawLine);
		if (line.length === 0 || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) {
			continue;
		}
		const block: Block = isHeadingLine(line)
			? { kind: "heading", level: 1, children: [{ kind: "text", text: line }] }
			: { kind: "paragraph", children: [{ kind: "text", text: line }] };
		blocks.push({ page, block });
	}
	return blocks;
};

/** Split page blocks into document units at heading boundaries. */
const splitIntoUnits = (
	pageBlocks: PageBlock[],
	sourcePath: string,
	warnings: ExtractionWarning[]
): DocumentUnit[] => {
	const firstHeadingIndex = pageBlocks.findIndex(({ block }) => block.kind === "heading");
	if (firstHeadingIndex < 0) {
		warnings.push({
			code: "ambiguous-structure",
			message: "No reliable section headings were found; using one document unit.",
			severity: "warning",
			location: createLocation(sourcePath, pageBlocks[0]?.page ?? 1)
		});
		return [
			{
				id: nextUnitId(0),
				title: "Document",
				source: createLocation(sourcePath, pageBlocks[0]?.page ?? 1, 0.5),
				blocks: pageBlocks.map(({ block }) => block)
			}
		];
	}

	const units: DocumentUnit[] = [];
	let currentBlocks: Block[] = [];
	let currentTitle = "Document";
	let currentPage = pageBlocks[0]?.page ?? 1;
	for (const { page, block } of pageBlocks) {
		if (block.kind === "heading") {
			if (currentBlocks.length > 0) {
				units.push({
					id: nextUnitId(units.length),
					title: currentTitle,
					source: createLocation(sourcePath, currentPage, 0.8),
					blocks: currentBlocks
				});
			}
			currentBlocks = [block];
			currentTitle =
				block.children
					.map((child) => (child.kind === "text" ? child.text : ""))
					.join("")
					.trim() || `Section ${units.length + 1}`;
			currentPage = page;
		} else {
			currentBlocks.push(block);
		}
	}
	if (currentBlocks.length > 0) {
		units.push({
			id: nextUnitId(units.length),
			title: currentTitle,
			source: createLocation(sourcePath, currentPage, 0.8),
			blocks: currentBlocks
		});
	}
	return units;
};

/** Attach an image to the unit that contains its page. */
const addImageToUnit = (
	units: DocumentUnit[],
	page: number,
	image: ImageInline,
	sourcePath: string,
	warnings: ExtractionWarning[]
): void => {
	const unit =
		[...units].reverse().find((candidate) => {
			const pageNumber = candidate.source.page;
			return pageNumber !== undefined && pageNumber <= page;
		}) ?? units[0];
	if (unit === undefined) {
		return;
	}
	if (unit.source.page !== undefined && unit.source.page > page) {
		warnings.push({
			code: "low-confidence",
			message: `Image on page ${page} appears before the first section; it was attached to the first unit.`,
			severity: "warning",
			location: createLocation(sourcePath, page)
		});
	}
	unit.blocks.push({ kind: "paragraph", children: [image] });
};

/** Extract selectable text and embedded images from a digital PDF. */
export const extractPdf = async (input: ExtractionInput): Promise<ExtractedDocument> => {
	if (input.format !== "pdf") {
		throw new AppError("unsupported-structure", `Expected a PDF source, received ${input.format}.`);
	}

	const byteLength = input.bytes.byteLength;
	const parser = new PDFParse({ data: new Uint8Array(input.bytes) });
	try {
		const textResult = await parser.getText();
		const infoResult = await parser.getInfo();
		const pageBlocks = textResult.pages.flatMap((page) => createTextBlocks(page.text, page.num));
		if (pageBlocks.length === 0 || textResult.text.trim().length === 0) {
			throw new AppError("missing-text", "PDF has no selectable text. OCR is not enabled.");
		}

		const warnings: ExtractionWarning[] = [];
		const units = splitIntoUnits(pageBlocks, input.sourcePath, warnings);
		const assets: ImageAsset[] = [];
		for (const page of textResult.pages) {
			try {
				const imageResult = await parser.getImage({
					partial: [page.num],
					imageThreshold: 1,
					imageDataUrl: false,
					imageBuffer: true
				});
				for (const imagePage of imageResult.pages) {
					for (const image of imagePage.images) {
						const asset = createImageAsset(
							image.data,
							image.name,
							imagePage.pageNumber,
							input.sourcePath,
							assets.length,
							image.width,
							image.height
						);
						if (asset === undefined) {
							warnings.push({
								code: "unsupported-structure",
								message: `Embedded image has an unsupported format on page ${imagePage.pageNumber}.`,
								severity: "warning",
								location: createLocation(input.sourcePath, imagePage.pageNumber)
							});
							continue;
						}
						assets.push(asset);
						const inline: ImageInline = {
							kind: "image",
							assetId: asset.id
						};
						addImageToUnit(units, imagePage.pageNumber, inline, input.sourcePath, warnings);
					}
				}
			} catch (error) {
				warnings.push({
					code: "unresolved-resource",
					message: `Embedded PDF images could not be extracted on page ${page.num}: ${String(error)}`,
					severity: "warning",
					location: createLocation(input.sourcePath, page.num)
				});
				try {
					const screenshots = await parser.getScreenshot({
						partial: [page.num],
						scale: 1,
						imageDataUrl: false,
						imageBuffer: true
					});
					for (const screenshot of screenshots.pages) {
						const asset = createImageAsset(
							screenshot.data,
							`page-${page.num}`,
							page.num,
							input.sourcePath,
							assets.length,
							screenshot.width,
							screenshot.height
						);
						if (asset === undefined) {
							continue;
						}
						assets.push(asset);
						addImageToUnit(
							units,
							page.num,
							{ kind: "image", assetId: asset.id },
							input.sourcePath,
							warnings
						);
						warnings.push({
							code: "low-confidence",
							message: `Page ${page.num} was rendered as an image fallback because embedded images were unavailable.`,
							severity: "warning",
							location: createLocation(input.sourcePath, page.num)
						});
					}
				} catch {
					warnings.push({
						code: "dropped-content",
						message: `Page ${page.num} images could not be extracted or rendered.`,
						severity: "warning",
						location: createLocation(input.sourcePath, page.num)
					});
				}
			}
		}

		const title = getPdfTitle(infoResult.info, slugifyDocumentName(input.sourcePath));
		return {
			title,
			language: "und",
			source: {
				format: "pdf",
				path: input.sourcePath,
				size: byteLength
			},
			units,
			assets,
			warnings
		};
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}
		throw new AppError("malformed-source", `Unable to read PDF: ${String(error)}`);
	} finally {
		await parser.destroy();
	}
};

/** Create the PDF source adapter. */
export const pdfExtractor = {
	format: "pdf" as const,
	extract: extractPdf
};
