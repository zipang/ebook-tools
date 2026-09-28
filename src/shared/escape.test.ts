import { expect, test } from "bun:test";
import { escapeHtml } from "./escape.ts";

test("escapes the ampersand", () => {
	expect(escapeHtml("a & b")).toBe("a &amp; b");
});

test("escapes angle brackets", () => {
	expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
});

test("escapes the double quote", () => {
	expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
});

test("escapes the single quote", () => {
	expect(escapeHtml("it's")).toBe("it&#39;s");
});

test("escapes the ampersand before the other entities, so output does not double escape", () => {
	expect(escapeHtml("<a href='x'>&</a>")).toBe("&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;");
});

test("leaves plain text unchanged", () => {
	expect(escapeHtml("Chapter 1")).toBe("Chapter 1");
});

test("returns an empty string unchanged", () => {
	expect(escapeHtml("")).toBe("");
});

test("escapes a script tag in a way that cannot close the surrounding tag", () => {
	const escaped = escapeHtml('</script><img src=x onerror="alert(1)">');

	expect(escaped).not.toContain("<");
	expect(escaped).not.toContain(">");
});
