import { describe, expect, it } from "vitest";
import {
  GEMINI_DEFAULT_MODEL,
  chooseGeminiDefaultModel,
  geminiModelsPageUrl,
  isGeminiBaseUrl,
  parseGeminiModelsPage,
} from "./geminiModels";

describe("Gemini model discovery", () => {
  it("recognizes only the Google Gemini API host", () => {
    expect(
      isGeminiBaseUrl(
        "https://generativelanguage.googleapis.com/v1beta/openai",
      ),
    ).toBe(true);
    expect(
      isGeminiBaseUrl("https://generativelanguage.googleapis.com.example.com"),
    ).toBe(false);
  });

  it("builds a paginated Google ListModels URL", () => {
    const url = new URL(geminiModelsPageUrl("next page/+"));
    expect(url.pathname).toBe("/v1beta/models");
    expect(url.searchParams.get("pageSize")).toBe("1000");
    expect(url.searchParams.get("pageToken")).toBe("next page/+");
  });

  it("maps all chat-capable models and strips the resource prefix", () => {
    const page = parseGeminiModelsPage({
      models: [
        {
          name: "models/gemini-3.5-flash",
          displayName: "Gemini 3.5 Flash",
          supportedGenerationMethods: ["generateContent", "countTokens"],
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
      nextPageToken: "page-2",
    });
    expect(page).toEqual({
      models: [{ id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }],
      nextPageToken: "page-2",
    });
  });

  it("prefers the free Gemini 3.5 Flash default", () => {
    expect(
      chooseGeminiDefaultModel([
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        { id: GEMINI_DEFAULT_MODEL, name: "Gemini 3.5 Flash" },
      ]),
    ).toBe(GEMINI_DEFAULT_MODEL);
  });
});
