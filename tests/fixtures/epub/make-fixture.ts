import { strToU8, zipSync } from "fflate";

const MIMETYPE = "application/epub+zip";
export const PIXEL_PNG = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
	(character) => character.charCodeAt(0)
);
const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
	<rootfiles>
		<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
	</rootfiles>
</container>`;

const createPackage = (includeSecondChapter: boolean): string => `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Fixture Book</dc:title>
		<dc:language>en</dc:language>
	</metadata>
	<manifest>
		<item id="chapter-1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
		<item id="figure-1" href="images/figure-1.png" media-type="image/png"/>
		${includeSecondChapter ? '<item id="chapter-2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>' : ""}
	</manifest>
	<spine>
		<itemref idref="chapter-1"/>
		${includeSecondChapter ? '<itemref idref="chapter-2"/>' : ""}
	</spine>
</package>`;

const createChapter = (
	linkToSecondChapter: boolean,
	includeExtensionlessImage: boolean,
	includeRepeatedBullet: boolean,
	includeNestedImageLink: boolean
): string => `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Chapter 1</title></head>
	<body>
		<h1>Chapter 1</h1>
		<p>Hello <em>world</em>.</p>
		<p><img src="../images/figure-1.png" alt="A figure"/></p>
		<ul><li>First item</li><li>Second item</li></ul>
		<table><thead><tr><th>Column</th></tr></thead><tbody><tr><td>Value</td></tr></tbody></table>
		${includeExtensionlessImage ? '<p><img src="../images/figure" alt="No extension"/></p>' : ""}
		${includeRepeatedBullet ? '<p><img src="../images/bullet.png" alt="Image"/> One</p><p><img src="../images/bullet.png" alt="Image"/> Two</p>' : ""}
		${includeNestedImageLink ? '<p><a href="chapter-1.xhtml#top">CHAPTER <strong>Omit <img src="../images/figure-2.png" alt="Image"/> words</strong></a></p>' : ""}
		${linkToSecondChapter ? '<p><a href="chapter-2.xhtml#top">Next chapter</a></p>' : ""}
	</body>
</html>`;

const createSecondChapter = (): string => `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Chapter 2</title></head>
	<body id="top"><h1>Chapter 2</h1><p>Second chapter.</p></body>
</html>`;

const FONT_ENCRYPTION_XML = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
	<enc:EncryptedData>
		<enc:CipherData>
			<enc:CipherReference URI="fonts/font.ttf"/>
		</enc:CipherData>
	</enc:EncryptedData>
</encryption>`;

/** Create a small valid EPUB fixture. */
export const makeEpubFixture = (
	includeFigure = true,
	includeFontEncryption = false,
	includeSecondChapter = false,
	includeExtensionlessImage = false,
	includeRepeatedBullet = false,
	includeNestedImageLink = false
): Uint8Array => {
	const files: Record<string, Uint8Array> = {
		mimetype: strToU8(MIMETYPE),
		"META-INF/container.xml": strToU8(CONTAINER_XML),
		"OEBPS/content.opf": strToU8(createPackage(includeSecondChapter)),
		"OEBPS/text/chapter-1.xhtml": strToU8(
			createChapter(
				includeSecondChapter,
				includeExtensionlessImage,
				includeRepeatedBullet,
				includeNestedImageLink
			)
		)
	};

	if (includeFigure) {
		files["OEBPS/images/figure-1.png"] = PIXEL_PNG;
	}
	if (includeExtensionlessImage) {
		files["OEBPS/images/figure"] = PIXEL_PNG;
	}
	if (includeRepeatedBullet) {
		files["OEBPS/images/bullet.png"] = PIXEL_PNG;
	}
	if (includeNestedImageLink) {
		files["OEBPS/images/figure-2.png"] = PIXEL_PNG;
	}
	if (includeFontEncryption) {
		files["META-INF/encryption.xml"] = strToU8(FONT_ENCRYPTION_XML);
	}
	if (includeSecondChapter) {
		files["OEBPS/text/chapter-2.xhtml"] = strToU8(createSecondChapter());
	}

	return zipSync(files);
};

/** Create an EPUB fixture from an explicit ordered spine. */
export const makeSpineEpubFixture = (
	documents: { href: string; body: string }[],
	images: Record<string, Uint8Array> = {}
): Uint8Array => {
	const manifest = documents
		.map(
			(document, index) =>
				`<item id="doc-${index}" href="text/${document.href}" media-type="application/xhtml+xml"/>`
		)
		.join("");
	const spine = documents.map((_, index) => `<itemref idref="doc-${index}"/>`).join("");
	const packageXml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
		<dc:title>Spine Fixture</dc:title>
		<dc:language>en</dc:language>
	</metadata>
	<manifest>${manifest}</manifest>
	<spine>${spine}</spine>
</package>`;
	const files: Record<string, Uint8Array> = {
		mimetype: strToU8(MIMETYPE),
		"META-INF/container.xml": strToU8(CONTAINER_XML),
		"OEBPS/content.opf": strToU8(packageXml)
	};

	documents.forEach((document, index) => {
		files[`OEBPS/text/${document.href}`] = strToU8(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml">
	<head><title>Doc ${index}</title></head>
	<body>${document.body}</body>
</html>`);
	});
	for (const [name, bytes] of Object.entries(images)) {
		files[`OEBPS/images/${name}`] = bytes;
	}

	return zipSync(files);
};
