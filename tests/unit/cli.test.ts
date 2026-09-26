import { describe, expect, test } from "bun:test";
import { createProgram } from "../../src/cli.ts";

describe("createProgram", () => {
	test("registers the public commands", () => {
		const program = createProgram();

		expect(program.commands.map((command) => command.name())).toEqual([
			"extract",
			"serve",
			"build",
			"delete"
		]);
	});

	test("accepts the extract options", async () => {
		const calls: unknown[] = [];
		const program = createProgram({
			extract: async (options) => {
				calls.push(options);
			},
			serve: async () => undefined,
			build: async () => undefined,
			delete: async () => undefined
		});

		program.exitOverride();
		await program.parseAsync(["node", "ebook-pipeline", "extract", "--input", "book.epub"]);

		expect(calls).toEqual([{ input: "book.epub" }]);
	});

	test("parses the delete parts as numbers", async () => {
		const calls: unknown[] = [];
		const program = createProgram({
			extract: async () => undefined,
			serve: async () => undefined,
			build: async () => undefined,
			delete: async (options) => {
				calls.push(options);
			}
		});

		program.exitOverride();
		await program.parseAsync([
			"node",
			"ebook-pipeline",
			"delete",
			"--document",
			"book",
			"--parts",
			"1",
			"3",
			"8"
		]);

		expect(calls).toEqual([{ document: "book", parts: [1, 3, 8] }]);
	});
});
