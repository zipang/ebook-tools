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

let defaultTemplatePromise: Promise<TemplateSet> | undefined;

/** Load document templates, falling back to the built-in editorial theme. */
export const loadTemplateSet = async (
	documentDir?: string,
	templatePaths: TemplatePaths = DEFAULT_TEMPLATE_PATHS
): Promise<TemplateSet> => {
	if (documentDir !== undefined) {
		const [base, styles] = await Promise.all([
			readDocumentFile(documentDir, templatePaths.base),
			readDocumentFile(documentDir, templatePaths.styles)
		]);

		return { base, styles };
	}

	defaultTemplatePromise ??= Promise.all([
		Bun.file(new URL("../templates/default/base.html", import.meta.url)).text(),
		Bun.file(new URL("../templates/default/print.css", import.meta.url)).text()
	]).then(([base, styles]) => ({ base, styles }));

	return defaultTemplatePromise;
};
