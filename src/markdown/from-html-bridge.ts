// Temporary bridge for the unmerged Bun.markdown.fromHTML API.
// Run this file with a bun-pr binary. Delete it when the PR merges.

type BridgeFromHtml = (html: string, options?: unknown) => string;

const fromHTML = (Bun.markdown as typeof Bun.markdown & { fromHTML?: BridgeFromHtml }).fromHTML;
if (typeof fromHTML !== "function") {
	console.error("This Bun build does not provide Bun.markdown.fromHTML.");
	process.exit(2);
}

const html = await Bun.stdin.text();
const rawOptions = process.env.FROM_HTML_OPTIONS;
const options = rawOptions === undefined || rawOptions.length === 0 ? undefined : JSON.parse(rawOptions);
process.stdout.write(options === undefined ? fromHTML(html) : fromHTML(html, options));

export {};
