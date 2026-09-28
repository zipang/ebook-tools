import { expect, test } from "bun:test";
import { detectImageFormat, isDirectlyEmbeddableImage } from "./image.ts";

/** Build a byte array from a list of byte values. */
const bytesOf = (...values: number[]): Uint8Array => new Uint8Array(values);

/** A PNG file header. */
const PNG = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
/** A JPEG start-of-image marker. */
const JPEG = bytesOf(0xff, 0xd8, 0xff, 0xe0);
/** A GIF header. */
const GIF = bytesOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
/** A RIFF container whose form type is WEBP. */
const WEBP = bytesOf(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);

test("identifies a PNG", () => {
	expect(detectImageFormat(PNG)).toEqual({ extension: ".png", mimeType: "image/png" });
});

test("identifies a JPEG", () => {
	expect(detectImageFormat(JPEG)).toEqual({ extension: ".jpg", mimeType: "image/jpeg" });
});

test("identifies a GIF", () => {
	expect(detectImageFormat(GIF)).toEqual({ extension: ".gif", mimeType: "image/gif" });
});

test("identifies a WebP from its RIFF container and its WEBP tag", () => {
	expect(detectImageFormat(WEBP)).toEqual({ extension: ".webp", mimeType: "image/webp" });
});

test("returns undefined for a signature it does not know", () => {
	expect(detectImageFormat(bytesOf(0x25, 0x50, 0x44, 0x46, 0x2d))).toBeUndefined();
});

test("returns undefined for empty bytes", () => {
	expect(detectImageFormat(bytesOf())).toBeUndefined();
});

test("returns undefined when the bytes are shorter than the signature", () => {
	expect(detectImageFormat(bytesOf(0x89, 0x50))).toBeUndefined();
});

test("does not read a WebP tag that sits at the wrong offset", () => {
	const notWebp = bytesOf(
		0x52,
		0x49,
		0x46,
		0x46,
		0x24,
		0x00,
		0x00,
		0x00,
		0x57,
		0x45,
		0x42,
		0x50,
		0x00,
		0x00
	).subarray(0, 4);

	expect(detectImageFormat(notWebp)).toBeUndefined();
});

test("treats PNG and JPEG as directly embeddable", () => {
	expect(isDirectlyEmbeddableImage(PNG)).toBe(true);
	expect(isDirectlyEmbeddableImage(JPEG)).toBe(true);
});

test("treats GIF and WebP as needing a conversion", () => {
	expect(isDirectlyEmbeddableImage(GIF)).toBe(false);
	expect(isDirectlyEmbeddableImage(WEBP)).toBe(false);
});
