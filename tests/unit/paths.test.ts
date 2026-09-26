import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRealPathInside } from "../../src/shared/paths.ts";

describe("resolveRealPathInside", () => {
	test("resolves a real path inside the root", async () => {
		const root = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));

		try {
			await mkdir(join(root, "assets"));
			await Bun.write(join(root, "assets", "image.png"), new Uint8Array([1]));

			const resolved = await resolveRealPathInside(root, join(root, "assets", "image.png"));

			expect(resolved).toContain("image.png");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects a symlink that escapes the root", async () => {
		const root = await mkdtemp(join(tmpdir(), "ebook-pipeline-"));
		const outside = await mkdtemp(join(tmpdir(), "ebook-outside-"));

		try {
			await Bun.write(join(outside, "secret.txt"), "secret");
			await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));

			await expect(resolveRealPathInside(root, join(root, "leak.txt"))).rejects.toThrow("escapes");
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
