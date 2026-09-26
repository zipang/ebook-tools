import { cp, mkdir, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { type RenderLinkOptions, renderIndexPage, renderUnitPage } from "../render/html.ts";
import { type PdfSection, renderHtmlToPdf } from "../render/pdf.ts";
import { loadDocumentContext } from "../server/routes.ts";
import { AppError } from "../shared/errors.ts";
import { resolveDocumentRoot, resolveRealPathInside } from "../shared/paths.ts";

export type BuildDocumentOptions = {
	repositoryRoot: string;
	documentName: string;
	format: "html" | "pdf";
	out: string;
};

export type BuildDocumentResult = {
	outputDir: string;
	format: "html" | "pdf";
	files: string[];
};

/** Resolve the output directory relative to the document directory. */
const resolveOutputDirectory = (documentDir: string, output: string): string => {
	return isAbsolute(output) ? resolve(output) : resolve(documentDir, output);
};

/** Reject symbolic links inside a directory tree. */
const assertNoSymlinks = async (directory: string): Promise<void> => {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink()) {
			throw new AppError("validation-error", `Symlinked assets are not allowed: ${path}`);
		}
		if (entry.isDirectory()) {
			await assertNoSymlinks(path);
		}
	}
};

/** Copy the document assets into the output directory. */
const copyAssets = async (documentDir: string, outputDir: string): Promise<void> => {
	const sourceAssets = join(documentDir, "assets");
	const outputAssets = join(outputDir, "assets");
	await resolveRealPathInside(documentDir, sourceAssets);
	await assertNoSymlinks(sourceAssets);
	await cp(sourceAssets, outputAssets, { recursive: true, dereference: true });
};

/** Write the HTML index page, unit pages, assets, and styles. */
const buildHtml = async (
	documentDir: string,
	outputDir: string,
	manifest: Parameters<typeof renderIndexPage>[0],
	templates: Parameters<typeof renderIndexPage>[1]
): Promise<string[]> => {
	const indexLinks: RenderLinkOptions = {
		indexHref: "index.html",
		stylesHref: "print.css",
		unitHref: (unitId) => `chapters/${encodeURIComponent(unitId)}.html`
	};
	const unitLinks: RenderLinkOptions = {
		indexHref: "../index.html",
		stylesHref: "../print.css",
		unitHref: (unitId) => `${encodeURIComponent(unitId)}.html`
	};
	const files: string[] = [];
	const indexPath = join(outputDir, "index.html");
	await Bun.write(indexPath, await renderIndexPage(manifest, templates, indexLinks));
	files.push(indexPath);
	await mkdir(join(outputDir, "chapters"), { recursive: true });

	for (const [index, unit] of manifest.units.entries()) {
		const markdownPath = join(documentDir, unit.path);
		const markdown = await Bun.file(markdownPath).text();
		const pagePath = join(outputDir, "chapters", `${unit.id}.html`);
		await Bun.write(pagePath, await renderUnitPage(manifest, index, markdown, templates, unitLinks));
		files.push(pagePath);
	}

	await copyAssets(documentDir, outputDir);
	const stylesPath = join(outputDir, "print.css");
	await Bun.write(stylesPath, templates?.styles ?? "");
	files.push(stylesPath);
	return files;
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

/** Render the document units into one local PDF file. */
const buildPdf = async (
	documentDir: string,
	outputDir: string,
	manifest: Parameters<typeof renderIndexPage>[0],
	templates: Parameters<typeof renderIndexPage>[1]
): Promise<string[]> => {
	const links: RenderLinkOptions = {
		indexHref: "../index.html",
		stylesHref: "../print.css",
		unitHref: (unitId) => `${encodeURIComponent(unitId)}.html`
	};
	const tableOfContents = `<section><h1>Contents</h1><ol>${manifest.units.map((unit) => `<li>${escapeHtml(unit.title)}</li>`).join("")}</ol></section>`;
	const sections: PdfSection[] =
		manifest.units.length > 1
			? [{ html: `<html><body>${tableOfContents}</body></html>`, unitPath: "chapters/toc.html" }]
			: [];
	for (const [index, unit] of manifest.units.entries()) {
		const markdown = await Bun.file(join(documentDir, unit.path)).text();
		sections.push({
			html: await renderUnitPage(manifest, index, markdown, templates, links),
			unitPath: unit.path
		});
	}
	const outputPath = join(outputDir, "document.pdf");
	await renderHtmlToPdf({
		documentDir,
		outputPath,
		title: manifest.title,
		language: manifest.language,
		sections
	});
	return [outputPath];
};

/** Build static HTML or a local PDF from one extracted document. */
export const buildDocument = async (options: BuildDocumentOptions): Promise<BuildDocumentResult> => {
	const documentDir = resolveDocumentRoot(options.repositoryRoot, options.documentName);
	const context = await loadDocumentContext(documentDir);
	const outputDir = resolveOutputDirectory(documentDir, options.out);
	await mkdir(outputDir, { recursive: true });
	const files =
		options.format === "html"
			? await buildHtml(documentDir, outputDir, context.manifest, context.templates)
			: await buildPdf(documentDir, outputDir, context.manifest, context.templates);
	return { outputDir, format: options.format, files };
};

/** Validate and run a build command. */
export const runBuild = async (options: BuildDocumentOptions): Promise<BuildDocumentResult> => {
	if (options.format !== "html" && options.format !== "pdf") {
		throw new AppError("validation-error", `Unsupported build format: ${options.format}`);
	}
	return buildDocument(options);
};
