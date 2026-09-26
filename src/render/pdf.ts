import { dirname, extname, resolve } from "node:path";
import { type ChildNode, type Element, isTag, isText } from "domhandler";
import { parseDocument } from "htmlparser2";
import PDFDocument from "pdfkit";
import { AppError } from "../shared/errors.ts";
import { isPathInside, resolveRealPathInside } from "../shared/paths.ts";

export type PdfSection = {
	html: string;
	unitPath: string;
};

export type RenderPdfOptions = {
	documentDir: string;
	outputPath: string;
	title: string;
	language: string;
	sections: PdfSection[];
};

/** Collect the normalized text of a node list. */
const getText = (nodes: ChildNode[]): string => {
	return nodes
		.map((node) => {
			if (isText(node)) {
				return node.data;
			}
			if (isTag(node)) {
				return getText(node.children);
			}
			return "";
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim();
};

/** Resolve a local image source inside the document directory. */
const getImagePath = (documentDir: string, unitPath: string, source: string): string | undefined => {
	try {
		const decoded = decodeURIComponent(source);
		if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(decoded)) {
			return undefined;
		}
		const baseDirectory = dirname(resolve(documentDir, unitPath));
		const path = resolve(baseDirectory, decoded);
		return isPathInside(resolve(documentDir), path) ? path : undefined;
	} catch {
		return undefined;
	}
};

/** Add one local image to the PDF page. */
const addImage = async (
	document: PDFKit.PDFDocument,
	documentDir: string,
	unitPath: string,
	source: string
): Promise<void> => {
	const path = getImagePath(documentDir, unitPath, source);
	if (path === undefined || extname(path).toLowerCase() === ".svg") {
		return;
	}
	try {
		const safePath = await resolveRealPathInside(resolve(documentDir), path);
		const file = Bun.file(safePath);
		if (!(await file.exists())) {
			return;
		}
		let bytes = Buffer.from(await file.arrayBuffer());
		const isPng =
			bytes.length >= 8 &&
			bytes[0] === 0x89 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47;
		const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		if (!isPng && !isJpeg) {
			bytes = Buffer.from(await new Bun.Image(bytes).png().bytes());
		}
		document.image(bytes, { fit: [500, 320], align: "center" });
		document.moveDown(0.5);
	} catch (error) {
		console.warn(`Skipped image ${source}: ${String(error)}`);
	}
};

type InlineTextOptions = {
	font?: string;
	size?: number;
	indent?: number;
};

/** Render inline nodes into the current PDF text flow. */
const renderInlineNodes = async (
	document: PDFKit.PDFDocument,
	nodes: ChildNode[],
	documentDir: string,
	unitPath: string,
	options: InlineTextOptions = {}
): Promise<void> => {
	const font = options.font ?? "Helvetica";
	const size = options.size ?? 11;
	let buffer = "";
	/** Write the buffered text into the PDF page. */
	const flush = async (): Promise<void> => {
		const text = buffer.replace(/\s+/g, " ").trim();
		if (text.length > 0) {
			const textOptions = options.indent === undefined ? {} : { indent: options.indent };
			document.font(font).fontSize(size).text(text, textOptions);
		}
		buffer = "";
	};

	for (const node of nodes) {
		if (isText(node)) {
			buffer += node.data;
			continue;
		}
		if (!isTag(node)) {
			continue;
		}
		if (node.name.toLowerCase() === "img") {
			await flush();
			const source = node.attribs.src;
			if (source !== undefined) {
				await addImage(document, documentDir, unitPath, source);
			}
			continue;
		}
		if (node.name.toLowerCase() === "br") {
			buffer += "\n";
			continue;
		}
		await renderInlineNodes(document, node.children, documentDir, unitPath, options);
	}
	await flush();
};

/** Collect the rows of a table element in document order. */
const collectTableRows = (element: Element): Element[] => {
	const rows: Element[] = [];
	for (const child of element.children) {
		if (!isTag(child)) {
			continue;
		}
		const name = child.name.toLowerCase();
		if (name === "tr") {
			rows.push(child);
			continue;
		}
		if (name === "thead" || name === "tbody" || name === "tfoot" || name === "table") {
			rows.push(...collectTableRows(child));
		}
	}
	return rows;
};

/** Join the cell text of one table row. */
const getTableRowText = (row: Element): string => {
	const cells = row.children
		.filter((child): child is Element => isTag(child) && ["td", "th"].includes(child.name.toLowerCase()))
		.map((cell) => getText(cell.children));
	return cells.join(" | ");
};

/** Render block nodes into the PDF page. */
const renderNodes = async (
	document: PDFKit.PDFDocument,
	nodes: ChildNode[],
	documentDir: string,
	unitPath: string
): Promise<void> => {
	for (const node of nodes) {
		if (isText(node)) {
			const text = node.data.replace(/\s+/g, " ").trim();
			if (text.length > 0) {
				document.font("Helvetica").fontSize(11).text(text);
			}
			continue;
		}
		if (!isTag(node)) {
			continue;
		}

		const name = node.name.toLowerCase();
		if (["script", "style", "nav", "head"].includes(name)) {
			continue;
		}
		if (/^h[1-6]$/.test(name)) {
			const level = Number(name.slice(1));
			await renderInlineNodes(document, node.children, documentDir, unitPath, {
				font: "Helvetica-Bold",
				size: level === 1 ? 24 : level === 2 ? 18 : 14
			});
			document.moveDown(0.6);
			continue;
		}
		if (name === "p" || name === "figcaption") {
			await renderInlineNodes(document, node.children, documentDir, unitPath);
			document.moveDown(0.6);
			continue;
		}
		if (name === "img") {
			const source = node.attribs.src;
			if (source !== undefined) {
				await addImage(document, documentDir, unitPath, source);
			}
			continue;
		}
		if (name === "ul" || name === "ol") {
			const ordered = name === "ol";
			let itemIndex = 1;
			for (const child of node.children) {
				if (isTag(child) && child.name.toLowerCase() === "li") {
					const marker = ordered ? `${itemIndex}.` : "•";
					document
						.font("Helvetica")
						.fontSize(11)
						.text(`${marker} `, { continued: true, indent: 18 });
					await renderInlineNodes(document, child.children, documentDir, unitPath, { indent: 18 });
					itemIndex += 1;
				}
			}
			document.moveDown(0.6);
			continue;
		}
		if (name === "blockquote") {
			await renderInlineNodes(document, node.children, documentDir, unitPath, {
				font: "Helvetica-Oblique",
				indent: 24
			});
			document.moveDown(0.6);
			continue;
		}
		if (name === "pre") {
			document.font("Courier").fontSize(9).text(getText(node.children));
			document.moveDown(0.6);
			document.font("Helvetica");
			continue;
		}
		if (name === "table") {
			for (const row of collectTableRows(node)) {
				document.font("Helvetica").fontSize(10).text(getTableRowText(row));
			}
			document.moveDown(0.6);
			continue;
		}
		await renderNodes(document, node.children, documentDir, unitPath);
	}
};

/** Render semantic HTML sections into a local PDF with PDFKit. */
export const renderHtmlToPdf = async (options: RenderPdfOptions): Promise<void> => {
	const document = new PDFDocument({
		size: "A4",
		margins: { top: 64, right: 64, bottom: 64, left: 64 },
		info: { Title: options.title },
		lang: options.language
	});
	const chunks: Buffer[] = [];
	const completed = new Promise<void>((resolvePromise, rejectPromise) => {
		document.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		document.on("end", resolvePromise);
		document.on("error", rejectPromise);
	});

	try {
		for (const [index, section] of options.sections.entries()) {
			if (index > 0) {
				document.addPage();
			}
			const parsed = parseDocument(section.html);
			const body = parsed.children.find(
				(node): node is Element => isTag(node) && node.name.toLowerCase() === "body"
			);
			await renderNodes(
				document,
				body?.children ?? parsed.children,
				options.documentDir,
				section.unitPath
			);
		}
		document.end();
		await completed;
		await Bun.write(options.outputPath, Buffer.concat(chunks));
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}
		throw new AppError("write-failed", `Unable to render PDF: ${String(error)}`);
	}
};
