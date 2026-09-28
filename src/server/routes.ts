import { extname, join, resolve } from "node:path";
import { renderIndexPage, renderUnitPage } from "../render/html.ts";
import type { DocumentContext } from "../services/document.ts";
import { AppError } from "../shared/errors.ts";
import { isPathInside, resolveRealPathInside } from "../shared/paths.ts";

const ALLOWED_ASSET_TYPES: Record<string, string> = {
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp"
};

const HTML_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"content-security-policy":
		"default-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'",
	"x-content-type-options": "nosniff"
};

/** Resolve an existing file that stays inside a root directory. */
const resolveExistingFile = async (root: string, relativePath: string): Promise<string> => {
	const lexicalPath = resolve(root, relativePath);
	if (!isPathInside(root, lexicalPath)) {
		throw new AppError("validation-error", `Path escapes document directory: ${relativePath}`);
	}
	return resolveRealPathInside(root, lexicalPath);
};

/** Read the Markdown source of one document unit. */
const readUnitMarkdown = async (context: DocumentContext, unitPath: string): Promise<string> => {
	const path = await resolveExistingFile(context.documentDir, unitPath);
	try {
		return await Bun.file(path).text();
	} catch {
		throw new AppError("malformed-source", `Unable to read Markdown unit: ${unitPath}`);
	}
};

/** Create a plain-text response with a status code. */
const createPlainText = (message: string, status: number): Response => {
	return new Response(message, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" }
	});
};

/** Create the request handler for one selected document. */
export const createDocumentFetch = (context: DocumentContext) => {
	const readPattern = new URLPattern({ pathname: "/read/:id" });

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return Response.json({ status: "ok" });
		}

		if (url.pathname === "/styles.css") {
			try {
				const stylesPath = await resolveExistingFile(
					context.documentDir,
					context.manifest.templates.styles
				);
				const styles = await Bun.file(stylesPath).text();
				return new Response(styles, {
					headers: {
						"content-type": "text/css; charset=utf-8",
						"x-content-type-options": "nosniff"
					}
				});
			} catch {
				return createPlainText("Stylesheet was not found.", 404);
			}
		}

		const readMatch = readPattern.exec(url);
		if (readMatch !== null) {
			const unitId = readMatch.pathname.groups.id;
			const index = context.manifest.units.findIndex((unit) => unit.id === unitId);
			const unit = context.manifest.units[index];
			if (unit === undefined) {
				return createPlainText("Document unit was not found.", 404);
			}
			try {
				const markdown = await readUnitMarkdown(context, unit.path);
				return new Response(
					await renderUnitPage(context.manifest, index, markdown, context.templates),
					{ headers: HTML_HEADERS }
				);
			} catch {
				return createPlainText("Unable to render document unit.", 400);
			}
		}

		if (url.pathname.startsWith("/assets/")) {
			try {
				const relativePath = decodeURIComponent(url.pathname.slice("/assets/".length));
				const assetPath = await resolveExistingFile(
					context.documentDir,
					join("assets", relativePath)
				);
				const contentType = ALLOWED_ASSET_TYPES[extname(assetPath).toLowerCase()];
				if (contentType === undefined) {
					return createPlainText("Asset type is not allowed.", 404);
				}
				const file = Bun.file(assetPath);
				return new Response(file, {
					headers: {
						"content-type": contentType,
						"x-content-type-options": "nosniff",
						"cache-control": "no-store"
					}
				});
			} catch {
				return createPlainText("Asset was not found.", 404);
			}
		}

		if (url.pathname === "/") {
			return new Response(await renderIndexPage(context.manifest, context.templates), {
				headers: HTML_HEADERS
			});
		}

		return createPlainText("Route was not found.", 404);
	};
};
