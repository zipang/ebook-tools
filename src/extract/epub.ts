import { posix } from "node:path";
import { type ChildNode, type Document as DomDocument, type Element, isTag, isText } from "domhandler";
import { unzipSync } from "fflate";
import { DomUtils, parseDocument } from "htmlparser2";
import { DEFAULT_FROM_HTML_OPTIONS, htmlToMarkdown } from "../markdown/from-html.ts";
import type {
	DocumentUnit,
	ExtractedDocument,
	ExtractionWarning,
	ImageAsset,
	SourceLocation
} from "../model/document.ts";
import { nextUnitId } from "../model/project.ts";
import { AppError } from "../shared/errors.ts";
import { detectImageFormat } from "../shared/image.ts";
import { slugifyDocumentName } from "../shared/paths.ts";
import type { ExtractionInput } from "./common.ts";

type Archive = Record<string, Uint8Array>;

type ManifestItem = {
	id: string;
	href: string;
	mediaType: string;
	path: string;
};

type ExtractionContext = {
	archive: Archive;
	sourcePath: string;
	assets: ImageAsset[];
	assetsByResource: Map<string, ImageAsset>;
	assetPaths: Set<string>;
	unitIdsByPath: Map<string, string>;
	decorativeResources: Set<string>;
	warnings: ExtractionWarning[];
};

type ChapterDraft = {
	path: string;
	source: SourceLocation;
	title: string;
	markdown: string;
	paths: string[];
};

/** Match a Markdown image link with an optional title and trailing spaces. */
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)([ \t]*)/g;

/** Match a Markdown link that is not an image, allowing nested bracket text. */
const MARKDOWN_LINK = /(?<!!)\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

/** Largest width or height of an image that can count as decorative. */
const DECORATIVE_MAX_DIMENSION = 16;

/** Smallest number of references before a repeated image counts as decorative. */
const DECORATIVE_MIN_REFERENCES = 2;

/**
 * Decode an archive entry, honouring a byte-order mark when one is present.
 *
 * An EPUB is a ZIP of text files, and a publisher may store any of them as
 * UTF-8, UTF-16 big endian, or UTF-16 little endian. The byte-order mark
 * says which, and TextDecoder defaults to UTF-8 when there is none.
 */
const decodeText = (bytes: Uint8Array): string => {
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
		return new TextDecoder("utf-16be").decode(bytes.subarray(2)).replace(/^\uFEFF/, "");
	}
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
		return new TextDecoder("utf-16le").decode(bytes.subarray(2)).replace(/^\uFEFF/, "");
	}
	return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
};

/**
 * Read one attribute of an element.
 *
 * The EPUB parsers look for attributes in both the exact case and the
 * lower-case form, because the OPF and the container document disagree
 * about attribute case. This helper holds that rule in one place.
 */
const getAttribute = (element: Element, name: string): string | undefined => {
	return element.attribs[name];
};

/**
 * Find the first element that matches a predicate.
 *
 * The container document names its root file with a namespaced tag, so the
 * lookup cannot be by a fixed tag name.
 */
const findElement = (
	root: Element | DomDocument,
	predicate: (element: Element) => boolean
): Element | undefined => {
	return DomUtils.findOne(predicate, root) ?? undefined;
};

/**
 * Read one archive entry, or return undefined when it is absent.
 *
 * A required entry that is missing means the archive is malformed, and the
 * function raises. An optional entry that is missing is a normal outcome,
 * such as a source that declares no encryption at all.
 */
const readArchiveEntry = (archive: Archive, path: string, required = true): Uint8Array | undefined => {
	const entry = archive[path];
	if (entry === undefined && required) {
		throw new AppError("malformed-source", `EPUB entry is missing: ${path}`);
	}
	return entry;
};

/**
 * Read one archive entry that the specification requires.
 *
 * The archive cannot be read without it, so a missing entry is malformed.
 */
const readRequiredArchiveEntry = (archive: Archive, path: string): Uint8Array => {
	const entry = readArchiveEntry(archive, path);
	if (entry === undefined) {
		throw new AppError("malformed-source", `EPUB entry is missing: ${path}`);
	}
	return entry;
};

/**
 * Return true when the only encrypted resources are fonts.
 *
 * A publisher may obfuscate embedded fonts without protecting the text.
 * Those files are ignored, and the document still extracts, so this
 * distinguishes that case from a genuinely encrypted book.
 */
const isFontOnlyEncryption = (archive: Archive): boolean => {
	const encryptionBytes = readArchiveEntry(archive, "META-INF/encryption.xml", false);
	if (encryptionBytes === undefined) {
		return true;
	}
	const encryptionDocument = parseDocument(decodeText(encryptionBytes), { xmlMode: true });
	const references = DomUtils.findAll(
		(element) => element.name.toLowerCase().endsWith("cipherreference"),
		encryptionDocument
	);
	return (
		references.length > 0 &&
		references.every((element) => {
			const uri = getAttribute(element, "URI") ?? getAttribute(element, "uri");
			return uri?.startsWith("fonts/") === true;
		})
	);
};

/**
 * Resolve an href from an EPUB document against the archive root.
 *
 * The result is the archive-relative key of an entry. A resource that
 * climbs out of the archive is rejected rather than read, because an
 * untrusted book must not be able to name a file outside itself.
 */
const resolveArchivePath = (baseDirectory: string, href: string): string => {
	const cleanHref = href.split("#", 1)[0] ?? "";
	const decodedHref = decodeURIComponent(cleanHref);
	const resolved = posix.normalize(posix.join(baseDirectory, decodedHref));
	if (resolved === ".." || resolved.startsWith("../")) {
		throw new AppError("malformed-source", `EPUB resource escapes the archive: ${href}`);
	}
	return resolved;
};

/**
 * Return true when a link leaves the document, so it is not rewritten.
 *
 * A link that carries a scheme, or that is protocol-relative, points at
 * another site and must survive extraction unchanged.
 */
const isExternalHref = (href: string): boolean => /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);

/** Collapse every run of whitespace into one space and trim the ends. */
const normalizeText = (text: string): string => {
	return text.replace(/\s+/g, " ").trim();
};

/**
 * Return the concatenated text of a node list, with markup discarded.
 *
 * The package document wraps its title and its language in namespaced
 * elements, so a tag-name lookup is not enough. The text is what matters.
 */
const textContent = (nodes: ChildNode[]): string => {
	return nodes
		.map((node) => {
			if (isText(node)) {
				return node.data;
			}
			if (isTag(node)) {
				return textContent(node.children);
			}
			return "";
		})
		.join("");
};

/**
 * Build the source location of a unit, for the manifest and the report.
 *
 * The selector is optional, because a spine item needs only its index.
 */
const createSourceLocation = (
	context: ExtractionContext,
	spineIndex: number,
	selector?: string
): SourceLocation => {
	const location: SourceLocation = {
		sourcePath: context.sourcePath,
		spineIndex
	};
	if (selector !== undefined) {
		location.selector = selector;
	}
	return location;
};

/** Build a unique asset file name for one archive resource. */
const createAssetFileName = (resourcePath: string, extension: string, context: ExtractionContext): string => {
	const baseName = slugifyDocumentName(posix.basename(resourcePath, posix.extname(resourcePath)));
	let fileName = `${baseName}${extension}`;
	let suffix = 2;
	while (context.assetPaths.has(fileName)) {
		fileName = `${baseName}-${suffix}${extension}`;
		suffix += 1;
	}
	context.assetPaths.add(fileName);
	return fileName;
};

/** Return the asset link as seen from a file under chapters/. */
const toChapterAssetLink = (manifestPath: string): string => {
	return manifestPath.startsWith("../") ? manifestPath : `../${manifestPath}`;
};

/** Register an image resource and return its Markdown link, or undefined. */
const registerImageLink = (
	context: ExtractionContext,
	resourcePath: string,
	altText: string,
	location: SourceLocation
): string | undefined => {
	const existing = context.assetsByResource.get(resourcePath);
	if (existing !== undefined) {
		return toChapterAssetLink(existing.path);
	}

	const bytes = readArchiveEntry(context.archive, resourcePath, false);
	if (bytes === undefined) {
		context.warnings.push({
			code: "unresolved-resource",
			message: `Image resource was not found: ${resourcePath}`,
			severity: "warning",
			location: { ...location, selector: resourcePath }
		});
		return undefined;
	}

	const format = detectImageFormat(bytes);
	if (format === undefined) {
		context.warnings.push({
			code: "unsupported-structure",
			message: `Image resource is not a supported image format: ${resourcePath}`,
			severity: "warning",
			location: { ...location, selector: resourcePath }
		});
		return undefined;
	}

	const fileName = createAssetFileName(resourcePath, format.extension, context);
	const asset: ImageAsset = {
		id: `asset-${String(context.assets.length + 1).padStart(3, "0")}`,
		path: `assets/images/${fileName}`,
		bytes,
		mimeType: format.mimeType,
		source: location
	};
	if (altText.length > 0) {
		asset.altText = altText;
	}
	context.assets.push(asset);
	context.assetsByResource.set(resourcePath, asset);
	return toChapterAssetLink(asset.path);
};

/** Count how often each archive image resource appears in the Markdown. */
const countImageReferences = (markdown: string, chapterPath: string): Map<string, number> => {
	const counts = new Map<string, number>();
	for (const match of markdown.matchAll(MARKDOWN_IMAGE)) {
		const source = match[2];
		if (source === undefined || source.startsWith("data:") || isExternalHref(source)) {
			continue;
		}
		let resourcePath: string;
		try {
			resourcePath = resolveArchivePath(posix.dirname(chapterPath), source);
		} catch {
			continue;
		}
		counts.set(resourcePath, (counts.get(resourcePath) ?? 0) + 1);
	}
	return counts;
};

/** Read the pixel size of an image resource. */
const measureImage = async (bytes: Uint8Array): Promise<{ width: number; height: number } | undefined> => {
	try {
		const metadata = await new Bun.Image(bytes).metadata();
		return { width: metadata.width, height: metadata.height };
	} catch {
		return undefined;
	}
};

/** Decide whether a small, reused image is a decorative bullet or icon. */
const isDecorativeImage = async (
	context: ExtractionContext,
	resourcePath: string,
	referenceCount: number
): Promise<boolean> => {
	if (referenceCount < DECORATIVE_MIN_REFERENCES) {
		return false;
	}
	if (context.decorativeResources.has(resourcePath)) {
		return true;
	}
	const bytes = readArchiveEntry(context.archive, resourcePath, false);
	if (bytes === undefined) {
		return false;
	}
	const size = await measureImage(bytes);
	if (
		size === undefined ||
		size.width > DECORATIVE_MAX_DIMENSION ||
		size.height > DECORATIVE_MAX_DIMENSION
	) {
		return false;
	}
	context.decorativeResources.add(resourcePath);
	context.warnings.push({
		code: "decorative-image",
		message: `Small reused image was treated as decorative: ${resourcePath}`,
		severity: "warning",
		location: { sourcePath: context.sourcePath, selector: resourcePath }
	});
	return true;
};

/** Copy image resources, drop decorative images, and rewrite links to assets. */
const rewriteImages = async (
	markdown: string,
	context: ExtractionContext,
	chapterPath: string,
	location: SourceLocation,
	referenceCounts: Map<string, number>
): Promise<string> => {
	const pieces: string[] = [];
	let lastIndex = 0;
	for (const match of markdown.matchAll(MARKDOWN_IMAGE)) {
		const index = match.index ?? 0;
		pieces.push(markdown.slice(lastIndex, index));
		lastIndex = index + match[0].length;

		const alt = match[1] ?? "";
		const source = match[2] ?? "";
		const title = match[3];
		const trailing = match[4] ?? "";

		if (source.startsWith("data:") || isExternalHref(source)) {
			pieces.push(match[0]);
			continue;
		}
		const resourcePath = resolveArchivePath(posix.dirname(chapterPath), source);
		const isDecorative = await isDecorativeImage(
			context,
			resourcePath,
			referenceCounts.get(resourcePath) ?? 0
		);
		if (isDecorative) {
			continue;
		}
		const link = registerImageLink(context, resourcePath, alt, location);
		if (link === undefined) {
			continue;
		}
		const titlePart = title === undefined ? "" : ` "${title}"`;
		pieces.push(`![${alt}](${link}${titlePart})${trailing}`);
	}
	pieces.push(markdown.slice(lastIndex));
	return pieces.join("");
};

/** Rewrite internal links to local read routes. */
const rewriteLinks = (
	markdown: string,
	context: ExtractionContext,
	chapterPath: string,
	location: SourceLocation
): string => {
	return markdown.replace(MARKDOWN_LINK, (match, text: string, href: string, title: string | undefined) => {
		if (href.length === 0 || href.startsWith("#") || href.startsWith("/read/") || isExternalHref(href)) {
			return match;
		}
		const [pathPart = "", fragment] = href.split("#", 2);
		if (pathPart.length === 0) {
			return match;
		}
		const resourcePath = resolveArchivePath(posix.dirname(chapterPath), pathPart);
		const unitId = context.unitIdsByPath.get(resourcePath);
		if (unitId === undefined) {
			context.warnings.push({
				code: "unresolved-resource",
				message: `Internal link target was not found: ${href}`,
				severity: "warning",
				location
			});
			return `[${text}](#)`;
		}
		const target = `/read/${unitId}${fragment === undefined ? "" : `#${fragment}`}`;
		const titlePart = title === undefined ? "" : ` "${title}"`;
		return `[${text}](${target}${titlePart})`;
	});
};

const HEADING_LINE = /^#{1,6}[ \t]+/;

/** Return the readable words of a unit, without headings or Markdown syntax. */
const readableText = (markdown: string): string => {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^[ \t]*>[ \t]?/gm, "")
		.replace(/^[ \t]*[-*+][ \t]+/gm, "")
		.replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
		.replace(/[*_~#>|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
};

/** Return the heading lines of a unit. */
const headingLines = (markdown: string): string[] => {
	return markdown.split("\n").filter((line) => HEADING_LINE.test(line));
};

/** Return the unit Markdown without its heading lines. */
const withoutHeadings = (markdown: string): string => {
	return markdown
		.split("\n")
		.filter((line) => !HEADING_LINE.test(line))
		.join("\n");
};

/** Check whether a unit has no readable content at all. */
const isEmptyChapter = (markdown: string): boolean => {
	return headingLines(markdown).length === 0 && readableText(markdown).length === 0;
};

/** Check whether a unit is only a heading, with no body content. */
const isTitleOnlyChapter = (markdown: string): boolean => {
	return headingLines(markdown).length > 0 && readableText(withoutHeadings(markdown)).length === 0;
};

/** Reduce a heading to plain text, dropping images and code. */
const plainTitle = (text: string): string => {
	return normalizeText(
		text
			.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/`([^`]*)`/g, "$1")
			.replace(/[*_~]/g, "")
	);
};

/** Take the first words of a text block. */
const firstWords = (text: string, count = 10): string => {
	return text.split(/\s+/).filter(Boolean).slice(0, count).join(" ");
};

/** Derive a unit title from the first h1 or h2, else the first ten words. */
const deriveTitle = (markdown: string): string => {
	const match = /^#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(markdown);
	if (match !== null && match[1] !== undefined) {
		const title = plainTitle(match[1]);
		if (title.length > 0) {
			return title;
		}
	}
	const fallback = firstWords(readableText(markdown));
	return fallback.length > 0 ? fallback : "Untitled";
};

/**
 * Read the manifest items of the package document, with resolved paths.
 *
 * An item without an id or an href is unusable, so the reader drops it
 * rather than inventing a key for it.
 */
const parseManifestItems = (packageDocument: DomDocument, opfPath: string): ManifestItem[] => {
	const opfDirectory = posix.dirname(opfPath);
	return DomUtils.getElementsByTagName("item", packageDocument)
		.map((element) => {
			const id = getAttribute(element, "id");
			const href = getAttribute(element, "href");
			if (id === undefined || href === undefined) {
				return undefined;
			}
			return {
				id,
				href,
				mediaType: getAttribute(element, "media-type") ?? "application/octet-stream",
				path: resolveArchivePath(opfDirectory, href)
			};
		})
		.filter((item): item is ManifestItem => item !== undefined);
};

/**
 * Find the package document of the archive through the container file.
 *
 * The container document points at the package document, and its path
 * varies per book. A container that declares no root file is malformed.
 */
const parseContainerPath = (archive: Archive): string => {
	const containerBytes = readRequiredArchiveEntry(archive, "META-INF/container.xml");
	const containerDocument = parseDocument(decodeText(containerBytes), { xmlMode: true });
	const rootFile = findElement(containerDocument, (element) => element.name.toLowerCase() === "rootfile");
	const fullPath = rootFile === undefined ? undefined : getAttribute(rootFile, "full-path");
	if (fullPath === undefined) {
		throw new AppError("malformed-source", "EPUB container does not declare a root file.");
	}
	return resolveArchivePath(".", fullPath);
};

/**
 * Read the title and the language from the package document.
 *
 * Both elements are namespaced and both are optional in a malformed book,
 * so each falls back to an empty string and the caller decides the default.
 */
const parsePackageMetadata = (packageDocument: DomDocument): { title: string; language: string } => {
	const titleElement = findElement(packageDocument, (element) =>
		element.name.toLowerCase().endsWith(":title")
	);
	const languageElement = findElement(packageDocument, (element) =>
		element.name.toLowerCase().endsWith(":language")
	);
	const title = titleElement === undefined ? "" : normalizeText(textContent(titleElement.children));
	const language =
		languageElement === undefined ? "" : normalizeText(textContent(languageElement.children));
	return { title, language };
};

/** Read one spine document into a draft unit. Images are copied here. */
const readChapterMarkdown = async (
	archive: Archive,
	chapterPath: string,
	spineIndex: number,
	context: ExtractionContext
): Promise<ChapterDraft> => {
	const chapterBytes = readRequiredArchiveEntry(archive, chapterPath);
	const location = createSourceLocation(context, spineIndex, chapterPath);
	const html = decodeText(chapterBytes);
	const rawMarkdown = htmlToMarkdown(html, DEFAULT_FROM_HTML_OPTIONS);
	const referenceCounts = countImageReferences(rawMarkdown, chapterPath);
	const markdown = await rewriteImages(rawMarkdown, context, chapterPath, location, referenceCounts);
	return {
		path: chapterPath,
		source: location,
		title: deriveTitle(markdown),
		markdown,
		paths: [chapterPath]
	};
};

/** Drop empty units and merge title-only units into the next unit. */
const mergeTitleOnlyChapters = (chapters: ChapterDraft[]): ChapterDraft[] => {
	const merged: ChapterDraft[] = [];
	let pending: ChapterDraft[] = [];
	for (const chapter of chapters) {
		if (isEmptyChapter(chapter.markdown)) {
			continue;
		}
		if (isTitleOnlyChapter(chapter.markdown)) {
			pending.push(chapter);
			continue;
		}
		if (pending.length > 0) {
			const prefix = pending.map((entry) => entry.markdown).join("\n\n");
			chapter.markdown = `${prefix}\n\n${chapter.markdown}`;
			chapter.paths = [...pending.flatMap((entry) => entry.paths), ...chapter.paths];
			pending = [];
		}
		merged.push(chapter);
	}
	return merged;
};

/** Keep only the image assets that the final Markdown references. */
const filterUnusedAssets = (assets: ImageAsset[], units: DocumentUnit[]): ImageAsset[] => {
	const referenced = new Set<string>();
	for (const unit of units) {
		for (const match of (unit.markdown ?? "").matchAll(/\.\.\/(assets\/images\/[^)\s"]+)/g)) {
			if (match[1] !== undefined) {
				referenced.add(match[1]);
			}
		}
	}
	return assets.filter((asset) => referenced.has(asset.path));
};

/** Extract semantic Markdown content and local images from an EPUB. */
export const extractEpub = async (input: ExtractionInput): Promise<ExtractedDocument> => {
	if (input.format !== "epub") {
		throw new AppError("unsupported-structure", `Expected an EPUB source, received ${input.format}.`);
	}

	let archive: Archive;
	try {
		archive = unzipSync(input.bytes);
	} catch (error) {
		throw new AppError("malformed-source", `Unable to read EPUB archive: ${String(error)}`);
	}

	const encryptionEntry = archive["META-INF/encryption.xml"];
	if (encryptionEntry !== undefined && !isFontOnlyEncryption(archive)) {
		throw new AppError("encrypted-source", "Encrypted EPUB files are not supported.");
	}
	if (archive.mimetype === undefined) {
		throw new AppError("malformed-source", "EPUB archive has no mimetype entry.");
	}

	const context: ExtractionContext = {
		archive,
		sourcePath: input.sourcePath,
		assets: [],
		assetsByResource: new Map(),
		assetPaths: new Set(),
		unitIdsByPath: new Map(),
		decorativeResources: new Set(),
		warnings:
			encryptionEntry === undefined
				? []
				: [
						{
							code: "unsupported-structure",
							message: "Obfuscated font resources were ignored.",
							severity: "warning",
							location: { sourcePath: input.sourcePath }
						}
					]
	};
	const opfPath = parseContainerPath(archive);
	const packageBytes = readRequiredArchiveEntry(archive, opfPath);
	const packageDocument = parseDocument(decodeText(packageBytes), { xmlMode: true });
	const metadata = parsePackageMetadata(packageDocument);
	const manifestItems = parseManifestItems(packageDocument, opfPath);
	const manifestById = new Map(manifestItems.map((item) => [item.id, item]));
	const spineElements = DomUtils.getElementsByTagName("itemref", packageDocument);
	const spineEntries = spineElements.flatMap((spineElement, spineIndex) => {
		const idref = getAttribute(spineElement, "idref");
		const item = idref === undefined ? undefined : manifestById.get(idref);
		if (item === undefined) {
			context.warnings.push({
				code: "unsupported-structure",
				message:
					idref === undefined
						? "Spine item has no idref."
						: `Spine references an unknown manifest item: ${idref}`,
				severity: "warning",
				location: createSourceLocation(context, spineIndex)
			});
			return [];
		}
		return [{ spineIndex, item }];
	});
	const drafts: ChapterDraft[] = [];
	for (const entry of spineEntries) {
		drafts.push(await readChapterMarkdown(archive, entry.item.path, entry.spineIndex, context));
	}
	const merged = mergeTitleOnlyChapters(drafts);
	merged.forEach((chapter, index) => {
		const unitId = nextUnitId(index);
		for (const path of chapter.paths) {
			context.unitIdsByPath.set(path, unitId);
		}
	});
	const units: DocumentUnit[] = merged.map((chapter, index) => {
		const markdown = rewriteLinks(chapter.markdown, context, chapter.path, chapter.source);
		return {
			id: nextUnitId(index),
			title: chapter.title,
			source: chapter.source,
			blocks: [],
			markdown
		};
	});

	if (units.length === 0) {
		throw new AppError("malformed-source", "EPUB spine does not contain readable documents.");
	}

	return {
		title: metadata.title || "Untitled document",
		language: metadata.language || "und",
		source: {
			format: "epub",
			path: input.sourcePath,
			size: input.bytes.byteLength
		},
		units,
		assets: filterUnusedAssets(context.assets, units),
		warnings: context.warnings
	};
};

/** Create the EPUB source adapter. */
export const epubExtractor = {
	format: "epub" as const,
	extract: extractEpub
};
