/**
 * Replace HTML special characters with character references.
 *
 * Every value interpolated into a page, a template, or a report goes
 * through this function. There is one implementation, so the escaping
 * cannot drift between the render paths.
 */
export const escapeHtml = (value: string): string => {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
};
