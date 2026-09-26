import { describe, expect, test } from "bun:test";
import type { ExtractedDocument } from "../../src/model/document.ts";
import { createManifest } from "../../src/model/project.ts";
import { renderIndexPage, renderUnitPage } from "../../src/render/html.ts";

const manifest = createManifest("example-book", {
	title: "Example Book",
	language: "en",
	source: { format: "epub", path: "sources/example.epub", size: 10 },
	units: [
		{
			id: "unit-001",
			title: "First",
			source: { sourcePath: "sources/example.epub", spineIndex: 0 },
			blocks: []
		},
		{
			id: "unit-002",
			title: "Second",
			source: { sourcePath: "sources/example.epub", spineIndex: 1 },
			blocks: []
		}
	],
	assets: [],
	warnings: []
} satisfies ExtractedDocument);

describe("HTML rendering", () => {
	test("renders a document index with ordered units", async () => {
		const html = await renderIndexPage(manifest);

		expect(html).toContain("<title>Example Book</title>");
		expect(html).toContain("First");
		expect(html).toContain("Second");
		expect(html).toContain('href="/read/unit-001"');
		expect(html).toContain('href="/styles.css"');
	});

	test("renders a unit with navigation and sanitized content", async () => {
		const html = await renderUnitPage(manifest, 0, "# First\n\nHello.");

		expect(html).toContain('lang="en"');
		expect(html).toContain('<h1 id="unit-title">First</h1>');
		expect(html).toContain("Next");
		expect(html).toContain('href="/read/unit-002"');
		expect(html).not.toContain("{{");
	});

	test("drops a leading heading that repeats the unit title", async () => {
		const html = await renderUnitPage(manifest, 0, "# First\n\nHello.");

		expect(html).toContain("Hello.");
		expect(html).not.toContain("<h2>First</h2>");
		expect(html.match(/First<\/h[12]>/g)).toHaveLength(1);
	});

	test("keeps a section heading that precedes the repeated title", async () => {
		const html = await renderUnitPage(manifest, 0, "# Part One\n\n## First\n\nHello.");

		expect(html).toContain("<h1>Part One</h1>");
		expect(html).toContain('<h1 id="unit-title">First</h1>');
		expect(html).not.toContain("<h2>First</h2>");
	});
});
