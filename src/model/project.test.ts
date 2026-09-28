import { expect, test } from "bun:test";
import { nextUnitId, nextUnitPath } from "./project.ts";

/*
 * The unit identifier and the unit path are part of the on-disk contract.
 * A document project stores them in its manifest, and serve, build, and
 * translate all read them back. These tests pin the exact format so a
 * change is deliberate, and it lands with a schema version bump.
 */

test("a unit id is the word unit, a hyphen, and a three-digit position", () => {
	expect(nextUnitId(0)).toBe("unit-001");
	expect(nextUnitId(1)).toBe("unit-002");
	expect(nextUnitId(9)).toBe("unit-010");
	expect(nextUnitId(99)).toBe("unit-100");
});

test("a unit id is one-based, because the first unit is the first", () => {
	expect(nextUnitId(0)).not.toBe(nextUnitId(1));
});

test("a unit path is a three-digit number, a slug, and a .md suffix", () => {
	expect(nextUnitPath(0, "Chapter One")).toBe("chapters/001-chapter-one.md");
	expect(nextUnitPath(11, "Chapter Twelve")).toBe("chapters/012-chapter-twelve.md");
});

test("a unit path lives under chapters and ends in .md", () => {
	const path = nextUnitPath(3, "Anything At All");

	expect(path.startsWith("chapters/")).toBe(true);
	expect(path.endsWith(".md")).toBe(true);
});

test("a unit path slugs the title the same way every other slug is built", () => {
	expect(nextUnitPath(0, "L'Été, Chapitre II")).toBe("chapters/001-l-ete-chapitre-ii.md");
});

test("two units in the same position cannot exist", () => {
	expect(nextUnitPath(0, "A")).not.toBe(nextUnitPath(0, "B"));
});
