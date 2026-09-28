// Temporary bridge for the unmerged Bun.markdown.fromHTML API.
// Run this file with a bun-pr binary. Delete it when the PR merges.
//
// This file is a subprocess. It reads the HTML on standard input, writes the
// Markdown on standard output, and reports a failure through its exit code.
// That is the whole protocol, so the only functions here are small.

/** The signature of the unmerged native converter. */
type BridgeFromHtml = (html: string, options?: unknown) => string;

/** The native converter of the bun-pr binary running this file. */
const nativeFromHtml = (Bun.markdown as typeof Bun.markdown & { fromHTML?: BridgeFromHtml }).fromHTML;

/** The HTML read from standard input, which is the whole input of the bridge. */
const html = await Bun.stdin.text();

/** The converter options, handed over by the parent process as JSON. */
const rawOptions = process.env.FROM_HTML_OPTIONS;

/** The parsed options, or undefined when the parent sent none. */
const options = rawOptions === undefined || rawOptions.length === 0 ? undefined : JSON.parse(rawOptions);

if (typeof nativeFromHtml !== "function") {
	console.error("This Bun build does not provide Bun.markdown.fromHTML.");
	process.exit(2);
}

process.stdout.write(options === undefined ? nativeFromHtml(html) : nativeFromHtml(html, options));

export {};
