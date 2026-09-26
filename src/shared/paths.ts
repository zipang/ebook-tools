import { lstat, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const SAFE_DOCUMENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Convert a source filename into a stable document directory name. */
export const slugifyDocumentName = (sourcePath: string): string => {
	const withoutExtension = basename(sourcePath, extname(sourcePath));
	const slug = withoutExtension
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug || "document";
};

/** Validate a document directory name. */
export const assertDocumentName = (name: string): string => {
	if (!SAFE_DOCUMENT_NAME.test(name)) {
		throw new Error(`Invalid document name: ${name}`);
	}

	return name;
};

/** Resolve one document directory inside a library. */
export const resolveDocumentRoot = (repositoryRoot: string, documentName: string): string => {
	assertDocumentName(documentName);
	return join(resolve(repositoryRoot), "documents", documentName);
};

/** Check whether a path is inside a root directory. */
export const isPathInside = (rootPath: string, candidatePath: string): boolean => {
	const root = resolve(rootPath);
	const candidate = resolve(candidatePath);
	const relativePath = relative(root, candidate);

	return (
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
	);
};

/** Reject a path that is a symbolic link. */
export const assertNotSymlink = async (path: string): Promise<void> => {
	try {
		const stats = await lstat(path);
		if (stats.isSymbolicLink()) {
			throw new Error(`Symbolic links are not allowed: ${path}`);
		}
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Symbolic links")) {
			throw error;
		}
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			throw new Error(`Document directory was not found: ${path}`);
		}
		throw new Error(`Unable to inspect path: ${path}`);
	}
};

/** Resolve an existing path and reject symlink escapes from the root. */
export const resolveRealPathInside = async (rootPath: string, candidatePath: string): Promise<string> => {
	const root = await realpath(rootPath);
	const candidate = await realpath(candidatePath);
	if (!isPathInside(root, candidate)) {
		throw new Error(`Path escapes the document root: ${candidatePath}`);
	}
	return candidate;
};

/** Convert a path to a manifest-friendly slash-separated path. */
export const toManifestPath = (path: string): string => path.replaceAll("\\", "/");
