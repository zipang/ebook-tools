import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeExtractedDocument } from "../../src/extract/writer.ts";
import type { ExtractedDocument } from "../../src/model/document.ts";
import { startDocumentServer } from "../../src/server/server.ts";

const createProject = async (): Promise<string> => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
	const document: ExtractedDocument = {
		title: "Served Book",
		language: "en",
		source: { format: "epub", path: "sources/served.epub", size: 10 },
		units: [
			{
				id: "unit-001",
				title: "First",
				source: { sourcePath: "sources/served.epub", spineIndex: 0 },
				blocks: []
			},
			{
				id: "unit-002",
				title: "Second",
				source: { sourcePath: "sources/served.epub", spineIndex: 1 },
				blocks: []
			}
		],
		assets: [
			{
				id: "asset-001",
				path: "assets/images/pixel.png",
				bytes: new Uint8Array([1, 2, 3]),
				mimeType: "image/png"
			}
		],
		warnings: []
	};
	await writeExtractedDocument({ repositoryRoot, documentName: "served-book", document });
	return repositoryRoot;
};

describe("startDocumentServer", () => {
	test("serves the selected document and current Markdown", async () => {
		const repositoryRoot = await createProject();
		const server = await startDocumentServer({
			repositoryRoot,
			documentName: "served-book",
			host: "127.0.0.1",
			port: 0
		});
		const baseUrl = `http://127.0.0.1:${server.port}`;

		try {
			const health = await fetch(`${baseUrl}/health`);
			const index = await fetch(`${baseUrl}/`);
			const first = await fetch(`${baseUrl}/read/unit-001`);
			const image = await fetch(`${baseUrl}/assets/images/pixel.png`);
			const styles = await fetch(`${baseUrl}/styles.css`);

			expect(health.status).toBe(200);
			expect(await health.json()).toEqual({ status: "ok" });
			expect(index.status).toBe(200);
			expect(await index.text()).toContain("Served Book");
			expect(styles.status).toBe(200);
			expect(styles.headers.get("content-type")).toContain("text/css");
			expect(first.status).toBe(200);
			expect(await first.text()).toContain("First");
			expect(image.status).toBe(200);
			expect(image.headers.get("content-type")).toContain("image/png");

			await Bun.write(
				join(repositoryRoot, "documents", "served-book", "chapters", "001-first.md"),
				"# Edited\n\nCurrent text."
			);
			const edited = await fetch(`${baseUrl}/read/unit-001`);
			expect(await edited.text()).toContain("Current text.");
		} finally {
			await server.stop(true);
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("rejects unsafe asset paths and unknown units", async () => {
		const repositoryRoot = await createProject();
		const server = await startDocumentServer({
			repositoryRoot,
			documentName: "served-book",
			host: "127.0.0.1",
			port: 0
		});
		const baseUrl = `http://127.0.0.1:${server.port}`;

		try {
			const unsafe = await fetch(`${baseUrl}/assets/%2e%2e/%2e%2e/manifest.json`);
			const unknown = await fetch(`${baseUrl}/read/unknown`);

			expect(unsafe.status).toBe(404);
			expect(unknown.status).toBe(404);
		} finally {
			await server.stop(true);
			await rm(repositoryRoot, { recursive: true, force: true });
		}
	});

	test("rejects a symlinked asset that escapes the document", async () => {
		const repositoryRoot = await createProject();
		const outside = await mkdtemp(join(tmpdir(), "ebook-outside-"));
		await Bun.write(join(outside, "secret.png"), new Uint8Array([1, 2, 3]));
		await symlink(
			join(outside, "secret.png"),
			join(repositoryRoot, "documents", "served-book", "assets", "images", "leak.png")
		);
		const server = await startDocumentServer({
			repositoryRoot,
			documentName: "served-book",
			host: "127.0.0.1",
			port: 0
		});

		try {
			const leak = await fetch(`http://127.0.0.1:${server.port}/assets/images/leak.png`);

			expect(leak.status).toBe(404);
		} finally {
			await server.stop(true);
			await rm(repositoryRoot, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("rejects a symlinked assets directory that escapes the document", async () => {
		const repositoryRoot = await createProject();
		const outside = await mkdtemp(join(tmpdir(), "ebook-outside-"));
		await Bun.write(join(outside, "secret.png"), new Uint8Array([1, 2, 3]));
		await rm(join(repositoryRoot, "documents", "served-book", "assets"), {
			recursive: true,
			force: true
		});
		await symlink(outside, join(repositoryRoot, "documents", "served-book", "assets"));
		const server = await startDocumentServer({
			repositoryRoot,
			documentName: "served-book",
			host: "127.0.0.1",
			port: 0
		});

		try {
			const leak = await fetch(`http://127.0.0.1:${server.port}/assets/secret.png`);

			expect(leak.status).toBe(404);
		} finally {
			await server.stop(true);
			await rm(repositoryRoot, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	test("rejects a symlinked template that escapes the document", async () => {
		const repositoryRoot = await createProject();
		const outside = await mkdtemp(join(tmpdir(), "ebook-outside-"));
		await Bun.write(join(outside, "base.html"), "<h1>Escaped</h1>");
		await rm(join(repositoryRoot, "documents", "served-book", "templates", "base.html"), {
			force: true
		});
		await symlink(
			join(outside, "base.html"),
			join(repositoryRoot, "documents", "served-book", "templates", "base.html")
		);

		try {
			await expect(
				startDocumentServer({
					repositoryRoot,
					documentName: "served-book",
					host: "127.0.0.1",
					port: 0
				})
			).rejects.toThrow("escapes");
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
