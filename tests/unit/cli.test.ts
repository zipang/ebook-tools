import { describe, expect, test } from "bun:test";
import { createProgram } from "../../src/cli.ts";

/** Create a program that throws instead of exiting, and stays quiet. */
const createTestProgram = (actions: Parameters<typeof createProgram>[0]) => {
	const program = createProgram(actions);

	program.exitOverride();
	program.configureOutput({ writeErr: () => {}, writeOut: () => {} });

	for (const command of program.commands) {
		command.exitOverride();
		command.configureOutput({ writeErr: () => {}, writeOut: () => {} });
	}

	return program;
};

const stubActions = (calls: { translate?: unknown[] }) => ({
	extract: async () => undefined,
	serve: async () => undefined,
	build: async () => undefined,
	delete: async () => undefined,
	translate: async (options: unknown) => {
		calls.translate?.push(options);
	}
});

describe("createProgram", () => {
	test("registers the public commands", () => {
		const program = createProgram();

		expect(program.commands.map((command) => command.name())).toEqual([
			"extract",
			"serve",
			"build",
			"delete",
			"translate"
		]);
	});

	test("accepts the extract options", async () => {
		const calls: unknown[] = [];
		const program = createTestProgram({
			extract: async (options) => {
				calls.push(options);
			},
			serve: async () => undefined,
			build: async () => undefined,
			delete: async () => undefined,
			translate: async () => undefined
		});

		await program.parseAsync(["node", "ebook-pipeline", "extract", "--input", "book.epub"]);

		expect(calls).toEqual([{ input: "book.epub" }]);
	});

	test("parses the delete parts as numbers", async () => {
		const calls: unknown[] = [];
		const program = createTestProgram({
			extract: async () => undefined,
			serve: async () => undefined,
			build: async () => undefined,
			delete: async (options) => {
				calls.push(options);
			},
			translate: async () => undefined
		});

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

	test("maps the translate options", async () => {
		const calls: unknown[] = [];
		const program = createTestProgram(stubActions({ translate: calls }));

		await program.parseAsync([
			"node",
			"ebook-pipeline",
			"translate",
			"--document",
			"book",
			"--to",
			"fr",
			"--model",
			"gemini-3-flash",
			"--out-document",
			"book-fr",
			"--concurrency",
			"6",
			"--only",
			"1",
			"3",
			"--force",
			"--max-cost",
			"0.5",
			"--report",
			"reports/custom.md",
			"--json"
		]);

		expect(calls).toEqual([
			{
				document: "book",
				to: "fr",
				model: "gemini-3-flash",
				outDocument: "book-fr",
				concurrency: 6,
				only: [1, 3],
				force: true,
				dryRun: undefined,
				cache: true,
				bestEffort: false,
				maxCost: 0.5,
				report: "reports/custom.md",
				json: true
			}
		]);
	});

	test("enables the cache by default and disables it with --no-cache", async () => {
		const calls: unknown[] = [];
		const program = createTestProgram(stubActions({ translate: calls }));

		await program.parseAsync([
			"node",
			"ebook-pipeline",
			"translate",
			"--document",
			"book",
			"--to",
			"fr",
			"--no-cache"
		]);

		expect((calls[0] as { cache: boolean }).cache).toBe(false);
	});

	test("requires the document and the target language", async () => {
		const program = createTestProgram(stubActions({}));

		await expect(
			program.parseAsync(["node", "ebook-pipeline", "translate", "--to", "fr"])
		).rejects.toThrow(/--document/);
		await expect(
			program.parseAsync(["node", "ebook-pipeline", "translate", "--document", "book"])
		).rejects.toThrow(/--to/);
	});

	test("accepts the dry run and best-effort flags", async () => {
		const calls: unknown[] = [];
		const program = createTestProgram(stubActions({ translate: calls }));

		await program.parseAsync([
			"node",
			"ebook-pipeline",
			"translate",
			"--document",
			"book",
			"--to",
			"fr",
			"--dry-run",
			"--best-effort"
		]);

		expect(calls[0]).toMatchObject({ dryRun: true, bestEffort: true });
	});
});
