import { loadDocumentContext } from "../services/document.ts";
import { resolveDocumentRoot } from "../shared/paths.ts";
import { createDocumentFetch } from "./routes.ts";

export type StartDocumentServerOptions = {
	repositoryRoot: string;
	documentName: string;
	host?: string | undefined;
	port?: number | undefined;
};

export type DocumentServer = Bun.Server<unknown>;

/** Start a local Bun server for one document directory. */
export const startDocumentServer = async (options: StartDocumentServerOptions): Promise<DocumentServer> => {
	const documentDir = resolveDocumentRoot(options.repositoryRoot, options.documentName);
	const context = await loadDocumentContext(documentDir);

	return Bun.serve({
		hostname: options.host ?? "127.0.0.1",
		port: options.port ?? 3000,
		fetch: createDocumentFetch(context)
	});
};
