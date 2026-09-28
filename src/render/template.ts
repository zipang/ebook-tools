import type { TemplateSet } from "../shared/templates.ts";

/** The values substituted into a base template. */
export type TemplateValues = {
	title: string;
	language: string;
	direction: "ltr" | "rtl";
	homeHref: string;
	stylesHref: string;
	content: string;
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

export type { TemplateSet };
