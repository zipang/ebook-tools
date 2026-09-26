import sanitize from "sanitize-html";

const allowedTags = [
	"a",
	"article",
	"blockquote",
	"br",
	"code",
	"del",
	"em",
	"figcaption",
	"figure",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"img",
	"li",
	"main",
	"mark",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"strong",
	"sub",
	"sup",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"ul"
];

/** Check whether a URL uses a scheme or a protocol-relative form. */
const isRemoteUrl = (value: string): boolean => {
	return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
};

/** Check whether a path contains a parent-directory segment. */
const hasTraversalSegment = (value: string): boolean => {
	return value.split(/[\\/]/).includes("..");
};

/** Check whether an image source stays inside the local assets folder. */
const isSafeImageSource = (value: string): boolean => {
	if (isRemoteUrl(value) || !/^(?:\.\.\/)?assets\/images\//.test(value)) {
		return false;
	}
	const rest = value.replace(/^(?:\.\.\/)?assets\/images\//, "");
	return rest.length > 0 && !rest.startsWith("/") && !hasTraversalSegment(rest);
};

/** Check whether a link target is safe for local rendering. */
const isSafeLinkHref = (value: string): boolean => {
	if (value.length === 0 || value.startsWith("#")) {
		return true;
	}
	if (/^(?:https?:|mailto:)/i.test(value) || value.startsWith("/read/")) {
		return true;
	}
	if (isRemoteUrl(value)) {
		return false;
	}
	return !hasTraversalSegment(value) && !value.includes("\0");
};

/** Sanitize an HTML fragment for local document rendering. */
export const sanitizeHtml = (html: string): string => {
	return sanitize(html, {
		allowedTags,
		allowedAttributes: {
			a: ["href", "title", "rel"],
			img: ["src", "alt", "title", "width", "height"],
			code: ["class"],
			ol: ["start"],
			th: ["scope"],
			td: ["colspan", "rowspan"]
		},
		allowedSchemes: ["http", "https", "mailto"],
		allowedSchemesByTag: {
			img: []
		},
		allowProtocolRelative: false,
		disallowedTagsMode: "discard",
		transformTags: {
			a: (tagName, attributes) => {
				const href = attributes.href;
				return {
					tagName,
					attribs: {
						...attributes,
						...(href === undefined || !isSafeLinkHref(href) ? { href: "#" } : {}),
						rel: "noreferrer noopener"
					}
				};
			}
		},
		exclusiveFilter: (frame) => {
			if (frame.tag !== "img") {
				return false;
			}
			const source = frame.attribs.src ?? "";
			return isSafeImageSource(source) ? false : "excludeTag";
		}
	});
};
