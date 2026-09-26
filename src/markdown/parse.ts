import { AppError } from "../shared/errors.ts";
import { sanitizeHtml } from "../shared/sanitize.ts";

/** Render Markdown into a sanitized HTML fragment. */
export const renderMarkdownToHtml = (markdown: string): string => {
	try {
		return sanitizeHtml(Bun.markdown.html(markdown));
	} catch (error) {
		throw new AppError("markdown-parse-error", `Unable to render Markdown: ${String(error)}`);
	}
};
