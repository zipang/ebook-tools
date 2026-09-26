import { join } from "node:path";
import { AppError } from "../shared/errors.ts";

/** Options for the native HTML to Markdown converter. */
export type FromHtmlOptions = {
	headingStyle?: "atx" | "setext";
	hr?: "---" | "***" | "___" | "- - -" | "* * *" | "_ _ _";
	bulletListMarker?: "-" | "*" | "+";
	codeBlockStyle?: "fenced" | "indented";
	fence?: "```" | "~~~";
	emDelimiter?: "_" | "*";
	strongDelimiter?: "**" | "__";
	br?: "  " | "\\";
	tables?: boolean;
	strikethrough?: boolean;
	tasklists?: boolean;
};

type NativeFromHtml = (html: string, options?: FromHtmlOptions) => string;

/** Options that match the current Markdown serializer style. */
export const DEFAULT_FROM_HTML_OPTIONS: FromHtmlOptions = {
	headingStyle: "atx",
	hr: "---",
	bulletListMarker: "-",
	codeBlockStyle: "fenced",
	fence: "```",
	emDelimiter: "*",
	strongDelimiter: "**",
	br: "  ",
	tables: true,
	strikethrough: true,
	tasklists: true
};

/** Return the native converter when the running Bun build provides it. */
const nativeFromHtml = (): NativeFromHtml | undefined => {
	const markdown = Bun.markdown as typeof Bun.markdown & { fromHTML?: NativeFromHtml };
	return markdown.fromHTML;
};

/**
 * Convert HTML through the temporary bun-pr binary.
 *
 * This is the compatibility path for Bun builds that do not include
 * `Bun.markdown.fromHTML` yet. Remove it when the PR merges.
 */
const convertWithPrBinary = (html: string, options?: FromHtmlOptions): string => {
	const binaryName = process.env.BUN_HTML_BIN ?? "bun-41527";
	const binary = Bun.which(binaryName);
	if (binary === null) {
		throw new AppError(
			"markdown-parse-error",
			`Bun.markdown.fromHTML is unavailable and the ${binaryName} binary was not found.`
		);
	}

	const bridge = join(import.meta.dir, "from-html-bridge.ts");
	const result = Bun.spawnSync({
		cmd: [binary, bridge],
		stdin: new TextEncoder().encode(html),
		env: { ...process.env, FROM_HTML_OPTIONS: JSON.stringify(options ?? {}) },
		stdout: "pipe",
		stderr: "pipe"
	});
	if (result.exitCode !== 0) {
		const stderr = new TextDecoder().decode(result.stderr).trim();
		throw new AppError("markdown-parse-error", `HTML to Markdown conversion failed: ${stderr}`);
	}
	return new TextDecoder().decode(result.stdout);
};

/** Convert an HTML document or fragment to Markdown. */
export const htmlToMarkdown = (html: string, options?: FromHtmlOptions): string => {
	const native = nativeFromHtml();
	if (native !== undefined) {
		return native(html, options);
	}
	return convertWithPrBinary(html, options);
};
