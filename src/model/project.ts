import { ValidationError } from "../shared/errors.ts";
import { assertDocumentName, slugifyDocumentName, toManifestPath } from "../shared/paths.ts";
import type { ExtractedDocument, SourceFormat, SourceLocation } from "./document.ts";

export const MANIFEST_SCHEMA_VERSION = 1;

export type ManifestSource = {
	format: SourceFormat;
	path: string;
	size: number;
};

export type ManifestUnit = {
	id: string;
	title: string;
	path: string;
	source: SourceLocation;
};

export type ManifestAsset = {
	id: string;
	path: string;
	mimeType: string;
	altText?: string;
	width?: number;
	height?: number;
};

export type DocumentManifest = {
	schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
	id: string;
	title: string;
	language: string;
	direction: "ltr" | "rtl";
	source: ManifestSource;
	units: ManifestUnit[];
	assets: ManifestAsset[];
	templates: {
		base: string;
		styles: string;
	};
};

const SAFE_UNIT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RIGHT_TO_LEFT_LANGUAGES = /^(ar|dv|fa|he|ps|ur|yi)(?:-|$)/i;

/** Derive the writing direction from a language code. */
export const directionForLanguage = (language: string): "ltr" | "rtl" => {
	return RIGHT_TO_LEFT_LANGUAGES.test(language) ? "rtl" : "ltr";
};

/** Validate a unit identifier and return it. */
const assertUnitId = (value: unknown, field: string): string => {
	const id = assertString(value, field);
	if (!SAFE_UNIT_ID.test(id)) {
		throw new ValidationError(`${field} must be a safe unit identifier`);
	}
	return id;
};

/** Validate a Markdown unit path and return it. */
const assertUnitPath = (value: unknown, field: string): string => {
	const path = assertRelativePath(value, field);
	if (!path.startsWith("chapters/") || !path.endsWith(".md")) {
		throw new ValidationError(`${field} must be a Markdown file under chapters/`);
	}
	return path;
};

/** Validate an image asset path and return it. */
const assertAssetPath = (value: unknown, field: string): string => {
	const path = assertRelativePath(value, field);
	if (!path.startsWith("assets/images/")) {
		throw new ValidationError(`${field} must be under assets/images/`);
	}
	return path;
};

/** Validate a template path and return it. */
const assertTemplatePath = (value: unknown, field: string): string => {
	const path = assertRelativePath(value, field);
	if (!path.startsWith("templates/")) {
		throw new ValidationError(`${field} must be under templates/`);
	}
	return path;
};

/** Check whether a value is a non-null object. */
const isRecord = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

/** Validate a non-empty string and return it. */
const assertString = (value: unknown, field: string): string => {
	if (typeof value !== "string" || value.length === 0) {
		throw new ValidationError(`${field} must be a non-empty string`);
	}

	return value;
};

/** Validate a relative path that stays inside the document directory. */
const assertRelativePath = (value: unknown, field: string): string => {
	const path = assertString(value, field).replaceAll("\\", "/");
	if (path.startsWith("/") || path.split("/").includes("..")) {
		throw new ValidationError(`${field} must stay inside the document directory`);
	}

	return path;
};

/** Check whether a value is a supported source format. */
const isSourceFormat = (value: unknown): value is SourceFormat => {
	return value === "epub" || value === "pdf";
};

/** Check whether a value is a valid source location. */
const isSourceLocation = (value: unknown): value is SourceLocation => {
	if (!isRecord(value) || typeof value.sourcePath !== "string") {
		return false;
	}

	return (
		(value.page === undefined || typeof value.page === "number") &&
		(value.spineIndex === undefined || typeof value.spineIndex === "number") &&
		(value.selector === undefined || typeof value.selector === "string") &&
		(value.confidence === undefined || typeof value.confidence === "number")
	);
};

/** Build a manifest from an extracted document. */
export const createManifest = (id: string, document: ExtractedDocument): DocumentManifest => {
	assertDocumentName(id);

	const units = document.units.map((unit, index) => ({
		id: assertUnitId(unit.id, `units[${index}].id`),
		title: unit.title,
		path: `chapters/${String(index + 1).padStart(3, "0")}-${slugifyDocumentName(unit.title)}.md`,
		source: unit.source
	}));

	const assets = document.assets.map((asset) => {
		const manifestAsset: ManifestAsset = {
			id: asset.id,
			path: toManifestPath(asset.path),
			mimeType: asset.mimeType
		};

		if (asset.altText !== undefined) {
			manifestAsset.altText = asset.altText;
		}
		if (asset.width !== undefined) {
			manifestAsset.width = asset.width;
		}
		if (asset.height !== undefined) {
			manifestAsset.height = asset.height;
		}

		return manifestAsset;
	});

	return {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		id,
		title: document.title,
		language: document.language || "und",
		direction: directionForLanguage(document.language || "und"),
		source: document.source,
		units,
		assets,
		templates: {
			base: "templates/base.html",
			styles: "templates/print.css"
		}
	};
};

/** Validate an untrusted manifest value. */
export const validateManifest = (value: unknown): DocumentManifest => {
	if (!isRecord(value)) {
		throw new ValidationError("manifest must be an object");
	}
	if (value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
		throw new ValidationError(`manifest schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
	}

	const id = assertString(value.id, "id");
	assertDocumentName(id);
	assertString(value.title, "title");
	assertString(value.language, "language");
	if (value.direction !== "ltr" && value.direction !== "rtl") {
		throw new ValidationError("direction must be ltr or rtl");
	}

	if (!isRecord(value.source) || !isSourceFormat(value.source.format)) {
		throw new ValidationError("source.format must be epub or pdf");
	}
	const sourcePath = assertRelativePath(value.source.path, "source.path");
	if (
		typeof value.source.size !== "number" ||
		!Number.isFinite(value.source.size) ||
		value.source.size < 0
	) {
		throw new ValidationError("source.size must be a non-negative number");
	}

	if (!Array.isArray(value.units) || value.units.length === 0) {
		throw new ValidationError("units must contain at least one unit");
	}
	const units = value.units.map((unit, index) => {
		if (!isRecord(unit)) {
			throw new ValidationError(`units[${index}] must be an object`);
		}
		if (!isSourceLocation(unit.source)) {
			throw new ValidationError(`units[${index}].source is invalid`);
		}

		return {
			id: assertUnitId(unit.id, `units[${index}].id`),
			title: assertString(unit.title, `units[${index}].title`),
			path: assertUnitPath(unit.path, `units[${index}].path`),
			source: unit.source
		};
	});
	const unitIds = new Set(units.map((unit) => unit.id));
	if (unitIds.size !== units.length) {
		throw new ValidationError("units must have unique ids");
	}
	const unitPaths = new Set(units.map((unit) => unit.path));
	if (unitPaths.size !== units.length) {
		throw new ValidationError("units must have unique paths");
	}

	if (!Array.isArray(value.assets)) {
		throw new ValidationError("assets must be an array");
	}
	const assets = value.assets.map((asset, index) => {
		if (!isRecord(asset)) {
			throw new ValidationError(`assets[${index}] must be an object`);
		}
		const manifestAsset: ManifestAsset = {
			id: assertString(asset.id, `assets[${index}].id`),
			path: assertAssetPath(asset.path, `assets[${index}].path`),
			mimeType: assertString(asset.mimeType, `assets[${index}].mimeType`)
		};
		if (asset.altText !== undefined) {
			manifestAsset.altText = assertString(asset.altText, `assets[${index}].altText`);
		}
		if (asset.width !== undefined) {
			if (typeof asset.width !== "number") {
				throw new ValidationError(`assets[${index}].width must be a number`);
			}
			manifestAsset.width = asset.width;
		}
		if (asset.height !== undefined) {
			if (typeof asset.height !== "number") {
				throw new ValidationError(`assets[${index}].height must be a number`);
			}
			manifestAsset.height = asset.height;
		}
		return manifestAsset;
	});

	if (!isRecord(value.templates)) {
		throw new ValidationError("templates must be an object");
	}

	return {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		id,
		title: value.title as string,
		language: value.language as string,
		direction: value.direction,
		source: {
			format: value.source.format,
			path: sourcePath,
			size: value.source.size
		},
		units,
		assets,
		templates: {
			base: assertTemplatePath(value.templates.base, "templates.base"),
			styles: assertTemplatePath(value.templates.styles, "templates.styles")
		}
	};
};

/** Serialize a manifest for disk. */
export const serializeManifest = (manifest: DocumentManifest): string => {
	return `${JSON.stringify(manifest, null, 2)}\n`;
};
