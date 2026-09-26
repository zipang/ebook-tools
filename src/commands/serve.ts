import { type DocumentServer, startDocumentServer } from "../server/server.ts";

/** Start the local preview server for one extracted document. */
export const runServe = async (
	options: { document: string; host?: string; port?: number },
	repositoryRoot = process.cwd()
): Promise<DocumentServer> => {
	const server = await startDocumentServer({
		repositoryRoot,
		documentName: options.document,
		...(options.host === undefined ? {} : { host: options.host }),
		...(options.port === undefined ? {} : { port: options.port })
	});
	console.log(`Serving ${options.document} at http://${options.host ?? "127.0.0.1"}:${server.port}`);
	return server;
};
