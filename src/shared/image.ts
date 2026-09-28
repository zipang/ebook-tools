/** The image formats the pipeline can store, with their file extension. */
export type ImageFormat = {
	extension: ".png" | ".jpg" | ".gif" | ".webp";
	mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50];

/** Return true when the bytes start with every byte of a signature. */
const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean => {
	if (bytes.length < offset + signature.length) {
		return false;
	}

	return signature.every((byte, index) => bytes[offset + index] === byte);
};

/**
 * Identify an image from its leading bytes, or return undefined.
 *
 * This is the only image signature reader in the project. An extractor
 * uses it to name and type a stored asset, and the PDF renderer uses it to
 * decide whether a file already needs no conversion.
 */
export const detectImageFormat = (bytes: Uint8Array): ImageFormat | undefined => {
	if (startsWith(bytes, PNG_SIGNATURE)) {
		return { extension: ".png", mimeType: "image/png" };
	}
	if (startsWith(bytes, JPEG_SIGNATURE)) {
		return { extension: ".jpg", mimeType: "image/jpeg" };
	}
	if (startsWith(bytes, GIF_SIGNATURE)) {
		return { extension: ".gif", mimeType: "image/gif" };
	}
	// A WebP file is a RIFF container whose form type is WEBP, at byte 8.
	if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_TAG, 8)) {
		return { extension: ".webp", mimeType: "image/webp" };
	}

	return undefined;
};

/** Return true when the bytes are a PNG or a JPEG, the two PDFKit embeds directly. */
export const isDirectlyEmbeddableImage = (bytes: Uint8Array): boolean => {
	const format = detectImageFormat(bytes);

	return format?.extension === ".png" || format?.extension === ".jpg";
};
