import { describe, expect, test } from "bun:test";
import { extractEpub } from "../../src/extract/epub.ts";
import { makeEpubFixture, makeSpineEpubFixture, PIXEL_PNG } from "../fixtures/epub/make-fixture.ts";

describe("extractEpub", () => {
	test("extracts spine order, semantic Markdown, and images", async () => {
		const document = await extractEpub({
			sourcePath: "sources/fixture.epub",
			format: "epub",
			bytes: makeEpubFixture()
		});

		expect(document.title).toBe("Fixture Book");
		expect(document.language).toBe("en");
		expect(document.units).toHaveLength(1);
		expect(document.units[0]?.title).toBe("Chapter 1");
		expect(document.units[0]?.markdown).toContain("# Chapter 1");
		expect(document.units[0]?.markdown).toContain("Hello *world*.");
		expect(document.units[0]?.markdown).toContain("![A figure](../assets/images/figure-1.png)");
		expect(document.units[0]?.markdown).toContain("- First item");
		expect(document.units[0]?.markdown).toContain("| Column |");
		expect(document.assets[0]?.path).toBe("assets/images/figure-1.png");
		expect(document.assets[0]?.bytes.byteLength).toBeGreaterThan(0);
	});

	test("records unresolved image resources", async () => {
		const document = await extractEpub({
			sourcePath: "sources/missing-image.epub",
			format: "epub",
			bytes: makeEpubFixture(false)
		});

		expect(document.warnings.some((warning) => warning.code === "unresolved-resource")).toBe(true);
	});

	test("rewrites internal XHTML links to extracted unit routes", async () => {
		const document = await extractEpub({
			sourcePath: "sources/linked.epub",
			format: "epub",
			bytes: makeEpubFixture(true, false, true)
		});

		expect(document.units).toHaveLength(2);
		expect(document.units[0]?.markdown).toContain("[Next chapter](/read/unit-002#top)");
	});

	test("derives asset extensions from detected image formats", async () => {
		const document = await extractEpub({
			sourcePath: "sources/extensionless.epub",
			format: "epub",
			bytes: makeEpubFixture(true, false, false, true)
		});
		const extensionlessAsset = document.assets.find((asset) => asset.path.endsWith("figure.png"));

		expect(extensionlessAsset?.mimeType).toBe("image/png");
	});

	test("drops small images that are reused as decorative bullets", async () => {
		const document = await extractEpub({
			sourcePath: "sources/bullets.epub",
			format: "epub",
			bytes: makeEpubFixture(true, false, false, false, true)
		});
		const markdown = document.units[0]?.markdown ?? "";

		expect(markdown).toContain("One");
		expect(markdown).toContain("Two");
		expect(markdown).not.toContain("bullet.png");
		expect(document.assets.some((asset) => asset.path.endsWith("figure-1.png"))).toBe(true);
		expect(document.assets.some((asset) => asset.path.endsWith("bullet.png"))).toBe(false);
		expect(document.warnings.filter((warning) => warning.code === "decorative-image")).toHaveLength(1);
	});

	test("rewrites an internal link whose text contains an image", async () => {
		const document = await extractEpub({
			sourcePath: "sources/nested.epub",
			format: "epub",
			bytes: makeEpubFixture(true, false, false, false, false, true)
		});
		const markdown = document.units[0]?.markdown ?? "";

		expect(markdown).toContain("](/read/unit-001#top)");
		expect(markdown).toContain("../assets/images/figure-2.png");
		expect(markdown).not.toContain("![Image](#)");
	});

	test("drops empty units, merges title-only units, and names units by content", async () => {
		const document = await extractEpub({
			sourcePath: "sources/spine.epub",
			format: "epub",
			bytes: makeSpineEpubFixture(
				[
					{ href: "empty.xhtml", body: "" },
					{
						href: "image-only.xhtml",
						body: '<p><img src="../images/figure-1.png" alt="Image"/></p>'
					},
					{ href: "section.xhtml", body: "<h1>Part One</h1>" },
					{
						href: "chapter.xhtml",
						body: '<h2>Chapter 1. Real</h2><p>Body text here.</p><p><a href="tail.xhtml">tail</a></p>'
					},
					{
						href: "tail.xhtml",
						body: "<p>First ten words of a unit without any heading at all in sight.</p>"
					}
				],
				{ "figure-1.png": PIXEL_PNG }
			)
		});

		expect(document.units.map((unit) => unit.id)).toEqual(["unit-001", "unit-002"]);
		expect(document.units[0]?.title).toBe("Chapter 1. Real");
		expect(document.units[1]?.title).toBe("First ten words of a unit without any heading at");
		expect(document.units[0]?.markdown?.startsWith("# Part One")).toBe(true);
		expect(document.units[0]?.markdown).toContain("](/read/unit-002)");
		expect(document.units.some((unit) => unit.markdown?.includes("!["))).toBe(false);
		expect(document.assets).toHaveLength(0);
	});

	test("ignores font-only encryption and records a warning", async () => {
		const document = await extractEpub({
			sourcePath: "sources/font-encrypted.epub",
			format: "epub",
			bytes: makeEpubFixture(true, true)
		});

		expect(document.units).toHaveLength(1);
		expect(document.warnings.some((warning) => warning.code === "unsupported-structure")).toBe(true);
	});
});
