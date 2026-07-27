import { describe, expect, it } from "vitest";
import {
  buildGeminiApiKeyHeaders,
  buildProviderAuthHeaders,
} from "./providerAuth";

describe("provider authentication headers", () => {
  it("trims compatible-provider bearer tokens", () => {
    expect(
      buildProviderAuthHeaders("https://api.openai.com/v1", "  secret  "),
    ).toEqual({ Authorization: "Bearer secret" });
  });

  it("sends both supported authentication headers to Gemini", () => {
    expect(
      buildProviderAuthHeaders(
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "  gemini-key  ",
      ),
    ).toEqual({
      Authorization: "Bearer gemini-key",
      "x-goog-api-key": "gemini-key",
    });
  });

  it("does not send empty credentials", () => {
    expect(
      buildProviderAuthHeaders("https://api.openai.com/v1", "   "),
    ).toEqual({});
  });

  it("uses only the API-key header for Google's native Gemini API", () => {
    expect(buildGeminiApiKeyHeaders("  gemini-key  ")).toEqual({
      "x-goog-api-key": "gemini-key",
    });
  });
});
