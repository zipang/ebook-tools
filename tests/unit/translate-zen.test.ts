import { describe, expect, test } from "bun:test";
import { AppError, ValidationError } from "../../src/shared/errors.ts";
import { findModel } from "../../src/translate/providers/registry.ts";
import { createZenModel, readZenBaseUrl, readZenCredentials } from "../../src/translate/providers/zen.ts";

const ENV = { OPENCODE_API_KEY: "test-key" };

describe("readZenCredentials", () => {
	test("reads the key and the default base URL", () => {
		expect(readZenCredentials(ENV)).toEqual({
			apiKey: "test-key",
			baseURL: "https://opencode.ai/zen/v1"
		});
	});

	test("reads an overridden base URL", () => {
		expect(readZenBaseUrl({ OPENCODE_ZEN_BASE_URL: "http://127.0.0.1:9000/v1" })).toBe(
			"http://127.0.0.1:9000/v1"
		);
	});

	test("rejects a missing key", () => {
		expect(() => readZenCredentials({})).toThrow(AppError);
		expect(() => readZenCredentials({})).toThrow("Missing OPENCODE_API_KEY");
	});

	test("rejects a blank key", () => {
		expect(() => readZenCredentials({ OPENCODE_API_KEY: "   " })).toThrow("Missing OPENCODE_API_KEY");
	});
});

describe("createZenModel", () => {
	test("builds an OpenAI-compatible model for a DeepSeek entry", () => {
		const model = createZenModel(findModel("deepseek-v4-flash"), ENV) as {
			specificationVersion: string;
			modelId: string;
		};

		expect(model.specificationVersion).toBe("v4");
		expect(model.modelId).toBe("deepseek-v4-flash");
	});

	test("builds a Google model for a Gemini entry", () => {
		const model = createZenModel(findModel("gemini-3-flash"), ENV) as {
			specificationVersion: string;
			modelId: string;
		};

		expect(model.specificationVersion).toBe("v4");
		expect(model.modelId).toBe("gemini-3-flash");
	});

	test("rejects an unsupported protocol", () => {
		const entry = { ...findModel("deepseek-v4-flash"), protocol: "anthropic" as const };

		expect(() => createZenModel(entry, ENV)).toThrow(ValidationError);
	});

	test("rejects a missing key before building the model", () => {
		expect(() => createZenModel(findModel("deepseek-v4-flash"), {})).toThrow("Missing OPENCODE_API_KEY");
	});
});

describe("providerOptionsKeyFor", () => {
	test("maps every protocol to its provider namespace", async () => {
		const { providerOptionsKeyFor } = await import("../../src/translate/providers/zen.ts");

		expect(providerOptionsKeyFor("openai-compatible")).toBe("opencodeZen");
		expect(providerOptionsKeyFor("openai")).toBe("openai");
		expect(providerOptionsKeyFor("google")).toBe("google");
	});
});
