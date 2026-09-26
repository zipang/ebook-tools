const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

const makePdf = (lines: string[]): Uint8Array => {
	const content = [
		"BT",
		"/F1 24 Tf",
		"72 720 Td",
		...lines.flatMap((line, index) => [
			index === 0
				? `(${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj`
				: `0 -36 Td (${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj`
		]),
		"ET"
	].join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${encode(content).byteLength} >>\nstream\n${content}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
	];
	let output = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(encode(output).byteLength);
		output += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xrefOffset = encode(output).byteLength;
	output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) {
		output += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return encode(output);
};

/** Create a small text PDF fixture. */
export const makePdfFixture = (lines = ["Chapter 1", "Hello world."]): Uint8Array => {
	return makePdf(lines);
};
