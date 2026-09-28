import { join } from "node:path";
import { type DocumentManifest, validateManifest } from "../model/project.ts";
import { AppError } from "../shared/errors.ts";
import { assertNotSymlink } from "../shared/paths.ts";
import { loadTemplateSet, type TemplateSet } from "../shared/templates.ts";

/** A loaded document project: its directory, its validated manifest, and its templates. */
export type DocumentContext = {
	documentDir: string;
	manifest: DocumentManifest;
	templates: TemplateSet;
};

/**
 * Read and validate the manifest of a document project.
 *
 * Every caller goes through this function, so a manifest is never read
 * without validation. A JSON or filesystem failure becomes an AppError.
 */
export const readDocumentManifest = async (documentDir: string): Promise<DocumentManifest> => {
	try {
		const text = await Bun.file(join(documentDir, "manifest.json")).text();

		return validateManifest(JSON.parse(text));
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}

		throw new AppError("malformed-source", `Unable to load document manifest: ${String(error)}`);
	}
};

/**
 * Load a document project for a caller that has no user interface.
 *
 * The function returns plain data. It starts no server and writes nothing
 * to the terminal, so the command line, the preview server, and a future
 * Web UI all call it the same way.
 */
export const loadDocumentContext = async (documentDir: string): Promise<DocumentContext> => {
	await assertNotSymlink(documentDir);
	const manifest = await readDocumentManifest(documentDir);

	return { documentDir, manifest, templates: await loadTemplateSet(documentDir, manifest.templates) };
};
