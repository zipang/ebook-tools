import type { ExtractedDocument, SourceFormat } from "../model/document.ts";

export type ExtractionInput = {
	sourcePath: string;
	format: SourceFormat;
	bytes: Uint8Array;
};

export type SourceExtractor = {
	format: SourceFormat;
	extract: (input: ExtractionInput) => Promise<ExtractedDocument>;
};
