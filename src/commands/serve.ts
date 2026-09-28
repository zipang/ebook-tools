import { type DocumentServer, startDocumentServer } from "../server/server.ts";

/** Options accepted by the serve command. */
export type ServeOptions = {
	document: string;
	host?: string;
	port?: number;
};

/** The result of starting the preview server for one document. */
export type ServeResult = {
	server: DocumentServer;
	url: string;
};

/**
 * Start the local preview server for one extracted document.
 *
 * The function returns the running server and the address it listens on.
 * It writes nothing to the terminal, so a Web UI can start a preview and
 * decide itself what to show the user.
 */
export const runServe = async (options: ServeOptions, repositoryRoot: string): Promise<ServeResult> => {
	const host = options.host ?? "127.0.0.1";
	const server = await startDocumentServer({
		repositoryRoot,
		documentName: options.document,
		host,
		...(options.port === undefined ? {} : { port: options.port })
	});

	return { server, url: `http://${host}:${server.port}` };
};
