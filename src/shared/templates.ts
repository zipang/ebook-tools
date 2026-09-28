import { join } from "node:path";
import { resolveRealPathInside } from "./paths.ts";

/** The base page and the print stylesheet of one document theme. */
export type TemplateSet = {
	base: string;
	styles: string;
};

/** The manifest-relative locations of a document theme. */
export type TemplatePaths = {
	base: string;
	styles: string;
};

const DEFAULT_TEMPLATE_PATHS: TemplatePaths = {
	base: "templates/base.html",
	styles: "templates/print.css"
};

/** Read one document template file and reject paths outside the document. */
const readDocumentFile = async (documentDir: string, relativePath: string): Promise<string> => {
	const resolved = await resolveRealPathInside(documentDir, join(documentDir, relativePath));

	return Bun.file(resolved).text();
};

/** Read the built-in editorial theme that ships with the tool. */
export const loadBuiltinTemplateSet = async (): Promise<TemplateSet> => {
	const [base, styles] = await Promise.all([
		Bun.file(new URL("../templates/default/base.html", import.meta.url)).text(),
		Bun.file(new URL("../templates/default/print.css", import.meta.url)).text()
	]);

	return { base, styles };
};

/**
 * Load the templates of one document project.
 *
 * The caller owns the cache lifetime. A long-running process, such as a
 * preview server or a Web UI, holds the result and reuses it, so a
 * module-level cache never makes the result depend on call order.
 */
export const loadDocumentTemplateSet = async (
	documentDir: string,
	templatePaths: TemplatePaths = DEFAULT_TEMPLATE_PATHS
): Promise<TemplateSet> => {
	const [base, styles] = await Promise.all([
		readDocumentFile(documentDir, templatePaths.base),
		readDocumentFile(documentDir, templatePaths.styles)
	]);

	return { base, styles };
};

/** Load a document theme, or the built-in theme when no project is given. */
export const loadTemplateSet = async (
	documentDir?: string,
	templatePaths: TemplatePaths = DEFAULT_TEMPLATE_PATHS
): Promise<TemplateSet> => {
	if (documentDir === undefined) {
		return loadBuiltinTemplateSet();
	}

	return loadDocumentTemplateSet(documentDir, templatePaths);
};
