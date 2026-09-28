import { renderMarkdownToHtml } from "../markdown/parse.ts";
import type { DocumentManifest } from "../model/project.ts";
import { loadTemplateSet, type TemplateSet } from "../shared/templates.ts";
import { applyTemplate } from "./template.ts";

export type RenderLinkOptions = {
	indexHref: string;
	stylesHref: string;
	unitHref: (unitId: string) => string;
};

const defaultLinkOptions: RenderLinkOptions = {
	indexHref: "/",
	stylesHref: "/styles.css",
	unitHref: (unitId) => `/read/${encodeURIComponent(unitId)}`
};

/** Replace HTML special characters with character references. */
const escapeHtml = (value: string): string => {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
};

/** Render one link to a document unit. */
const renderUnitLink = (unitId: string, title: string, links: RenderLinkOptions): string => {
	return `<li><a href="${escapeHtml(links.unitHref(unitId))}">${escapeHtml(title)}</a></li>`;
};

/** Render the previous, contents, and next navigation links. */
const renderNavigation = (manifest: DocumentManifest, index: number, links: RenderLinkOptions): string => {
	const previous = manifest.units[index - 1];
	const next = manifest.units[index + 1];
	const previousLink =
		previous === undefined
			? ""
			: `<a rel="prev" href="${escapeHtml(links.unitHref(previous.id))}">Previous</a>`;
	const nextLink =
		next === undefined ? "" : `<a rel="next" href="${escapeHtml(links.unitHref(next.id))}">Next</a>`;
	return `<nav class="unit-navigation" aria-label="Unit navigation"><span>${previousLink}</span><a href="${escapeHtml(links.indexHref)}">Contents</a><span>${nextLink}</span></nav>`;
};

/** Rewrite internal read links for the target output. */
const rewriteUnitLinks = (html: string, links: RenderLinkOptions): string => {
	return html.replace(/href="\/read\/([^"#?]+)([#?][^"]*)?"/g, (_match, unitId: string, suffix = "") => {
		const href = links.unitHref(decodeURIComponent(unitId));
		return `href="${escapeHtml(href)}${escapeHtml(suffix)}"`;
	});
};

/** Render the document contents page. */
export const renderIndexPage = async (
	manifest: DocumentManifest,
	templateSet?: TemplateSet,
	links: RenderLinkOptions = defaultLinkOptions
): Promise<string> => {
	const templates = templateSet ?? (await loadTemplateSet());
	const content = `<nav aria-labelledby="document-title"><h1 id="document-title">${escapeHtml(manifest.title)}</h1><p>${manifest.units.length} unit${manifest.units.length === 1 ? "" : "s"}</p><ol>${manifest.units.map((unit) => renderUnitLink(unit.id, unit.title, links)).join("")}</ol></nav>`;
	return applyTemplate(templates.base, {
		title: manifest.title,
		language: manifest.language,
		direction: manifest.direction,
		homeHref: links.indexHref,
		stylesHref: links.stylesHref,
		content
	});
};

/** Reduce a Markdown heading to plain text for comparison with a unit title. */
const plainHeadingText = (text: string): string => {
	return text
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/[*_~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
};

/**
 * Drop a heading that repeats the unit title.
 *
 * The scan covers the leading run of headings only, so a section heading that
 * a merged unit prepended stays in place while the repeated title is removed.
 */
const stripDuplicateTitle = (markdown: string, title: string): string => {
	const lines = markdown.split("\n");
	let index = 0;
	while (index < lines.length) {
		const line = lines[index]?.trim() ?? "";
		if (line.length === 0) {
			index += 1;
			continue;
		}
		const match = /^#{1,6}[ \t]+(.+?)[ \t]*$/.exec(line);
		if (match === null) {
			break;
		}
		if (match[1] !== undefined && plainHeadingText(match[1]) === title) {
			lines.splice(index, 1);
			while (index < lines.length && (lines[index]?.trim().length ?? 0) === 0) {
				lines.splice(index, 1);
			}
			return lines.join("\n");
		}
		index += 1;
	}
	return markdown;
};

/** Render one Markdown unit as a complete HTML page. */
export const renderUnitPage = async (
	manifest: DocumentManifest,
	index: number,
	markdown: string,
	templateSet?: TemplateSet,
	links: RenderLinkOptions = defaultLinkOptions
): Promise<string> => {
	const unit = manifest.units[index];
	if (unit === undefined) {
		throw new Error(`Unknown manifest unit index: ${index}`);
	}
	const templates = templateSet ?? (await loadTemplateSet());
	const body = renderMarkdownToHtml(stripDuplicateTitle(markdown, unit.title));
	const content = `<article aria-labelledby="unit-title"><h1 id="unit-title">${escapeHtml(unit.title)}</h1>${rewriteUnitLinks(body, links)}${renderNavigation(manifest, index, links)}</article>`;
	return applyTemplate(templates.base, {
		title: `${unit.title} — ${manifest.title}`,
		language: manifest.language,
		direction: manifest.direction,
		homeHref: links.indexHref,
		stylesHref: links.stylesHref,
		content
	});
};
