import { describe, expect, test } from "bun:test";
import { extractPdf } from "../../src/extract/pdf.ts";
import { makePdfFixture } from "../fixtures/pdf/make-fixture.ts";

describe("extractPdf", () => {
	test("extracts selectable text and detects a heading boundary", async () => {
		const document = await extractPdf({
			sourcePath: "sources/fixture.pdf",
			format: "pdf",
			bytes: makePdfFixture()
		});

		expect(document.title).toBe("fixture");
		expect(document.units).toHaveLength(1);
		expect(document.units[0]?.blocks[0]).toEqual({
			kind: "heading",
			level: 1,
			children: [{ kind: "text", text: "Chapter 1" }]
		});
		expect(document.units[0]?.blocks[1]).toEqual({
			kind: "paragraph",
			children: [{ kind: "text", text: "Hello world." }]
		});
	});

	test("keeps ambiguous text in one unit", async () => {
		const document = await extractPdf({
			sourcePath: "sources/ambiguous.pdf",
			format: "pdf",
			bytes: makePdfFixture(["A line without a heading", "Another line"])
		});

		expect(document.units).toHaveLength(1);
		expect(document.units[0]?.blocks.length).toBeGreaterThan(0);
	});
});
