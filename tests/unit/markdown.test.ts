import { describe, expect, test } from "bun:test";
import { renderMarkdownToHtml } from "../../src/markdown/parse.ts";

describe("renderMarkdownToHtml", () => {
	test("renders semantic Markdown with Bun.markdown", () => {
		const html = renderMarkdownToHtml("# Title\n\nHello **world**.");

		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("<strong>world</strong>");
	});

	test("removes scripts, event handlers, and remote images", () => {
		const html = renderMarkdownToHtml(
			[
				'<script>alert("x")</script>',
				'<img src="https://example.com/image.png" onerror="alert(1)">',
				'<img src="../assets/images/local.png" alt="Local">',
				'<a href="javascript:alert(1)">Bad link</a>'
			].join("\n\n")
		);

		expect(html).not.toContain("script");
		expect(html).not.toContain("onerror");
		expect(html).not.toContain("example.com");
		expect(html).not.toContain("javascript:");
		expect(html).toContain("../assets/images/local.png");
	});

	test("rejects traversal in local image sources and links", () => {
		const html = renderMarkdownToHtml(
			[
				'<img src="../../outside.png" alt="Outside">',
				'<img src="assets/images/../../../outside.png" alt="Outside">',
				'<a href="../../outside.md">Outside link</a>'
			].join("\n\n")
		);

		expect(html).not.toContain("../../outside.png");
		expect(html).not.toContain("outside.md");
	});
});
