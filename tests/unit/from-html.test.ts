import { describe, expect, test } from "bun:test";
import { DEFAULT_FROM_HTML_OPTIONS, htmlToMarkdown } from "../../src/markdown/from-html.ts";

describe("htmlToMarkdown", () => {
	test("converts headings and inline emphasis", () => {
		const markdown = htmlToMarkdown("<h1>Hi</h1><p>a <em>b</em> and <strong>c</strong></p>", {
			emDelimiter: "*",
			strongDelimiter: "**"
		});

		expect(markdown).toBe("# Hi\n\na *b* and **c**");
	});

	test("drops script and style content", () => {
		const markdown = htmlToMarkdown("<p>ok</p><script>alert(1)</script><style>x{}</style>");

		expect(markdown).toBe("ok");
	});

	test("converts tables, lists, and code with the default options", () => {
		const markdown = htmlToMarkdown(
			[
				"<table><thead><tr><th>Column</th></tr></thead><tbody><tr><td>Value</td></tr></tbody></table>",
				"<ul><li>First item</li></ul>",
				'<pre><code class="language-js">const a = 1;</code></pre>'
			].join(""),
			DEFAULT_FROM_HTML_OPTIONS
		);

		expect(markdown).toContain("| Column |");
		expect(markdown).toContain("- First item");
		expect(markdown).toContain("```js\nconst a = 1;\n```");
	});
});
