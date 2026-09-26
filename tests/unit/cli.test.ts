import { describe, expect, test } from "bun:test";
import { createProgram } from "../../src/cli.ts";

describe("createProgram", () => {
	test("registers the public commands", () => {
		const program = createProgram();

		expect(program.commands.map((command) => command.name())).toEqual(["extract", "serve", "build"]);
	});

	test("accepts the extract options", async () => {
		const calls: unknown[] = [];
		const program = createProgram({
			extract: async (options) => {
				calls.push(options);
			},
			serve: async () => undefined,
			build: async () => undefined
		});

		program.exitOverride();
		await program.parseAsync(["node", "ebook-pipeline", "extract", "--input", "book.epub"]);

		expect(calls).toEqual([{ input: "book.epub" }]);
	});
});
