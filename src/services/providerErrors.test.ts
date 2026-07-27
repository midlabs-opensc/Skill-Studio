import { describe, expect, it } from "vitest";
import { presentProviderError } from "./providerErrors";

describe("presentProviderError", () => {
  it.each([
    ["Provider returned HTTP 503: high demand", "temporarily busy"],
    ["Provider returned HTTP 429: quota exceeded", "request limit"],
    ["Provider returned HTTP 401: invalid key", "API key"],
    ["Provider returned HTTP 502: bad gateway", "temporarily busy"],
    ["Provider returned HTTP 504: gateway timeout", "temporarily busy"],
    ["Request timed out after 60000ms", "too long"],
    ["model_not_found", "could not be found"],
    ["This request exceeds the context length", "too long"],
    ["Provider returned invalid JSON.", "could not read"],
  ])("summarizes common provider errors", (detail, summary) => {
    const result = presentProviderError(new Error(detail));
    expect(result.recognized).toBe(true);
    expect(result.summary).toContain(summary);
    expect(result.detail).toBe(detail);
  });

  it("recognizes Gemini authorization-header failures", () => {
    const result = presentProviderError(
      new Error(
        "Provider returned HTTP 400: Missing or invalid Authorization header.",
      ),
    );
    expect(result.recognized).toBe(true);
    expect(result.summary).toContain("API key");
  });

  it("gives Ollama-specific connection guidance", () => {
    const result = presentProviderError(
      new Error("connection refused"),
      "ollama",
    );
    expect(result.summary).toContain("Ollama");
  });

  it("leaves uncommon errors unchanged", () => {
    const result = presentProviderError(new Error("Unexpected provider shape"));
    expect(result).toEqual({
      summary: "Unexpected provider shape",
      detail: "Unexpected provider shape",
      recognized: false,
    });
  });
});
