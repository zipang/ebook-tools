import { join } from "node:path";
import { resolveRealPathInside } from "../shared/paths.ts";

export type TemplateSet = {
	base: string;
	styles: string;
};

export type TemplatePaths = {
	base: string;
	styles: string;
};

export type TemplateValues = {
	title: string;
	language: string;
	direction: "ltr" | "rtl";
	homeHref: string;
	stylesHref: string;
	content: string;
};

const DEFAULT_TEMPLATE_PATHS: TemplatePaths = {
	base: "templates/base.html",
	styles: "templates/print.css"
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

/** Apply template values to a base template with HTML escaping. */
export const applyTemplate = (template: string, values: TemplateValues): string => {
	const replacements: Record<string, string> = {
		title: escapeHtml(values.title),
		language: escapeHtml(values.language),
		direction: escapeHtml(values.direction),
		homeHref: escapeHtml(values.homeHref),
		stylesHref: escapeHtml(values.stylesHref),
		content: values.content
	};
	return template.replace(
		/{{(title|language|direction|homeHref|stylesHref|content)}}/g,
		(_match, key: string) => {
			return replacements[key] ?? "";
		}
	);
};
