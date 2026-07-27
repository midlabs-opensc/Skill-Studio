import { GEMINI_API_HOST } from "./geminiModels";

export function buildProviderAuthHeaders(
  baseUrl: string,
  apiKey?: string,
): Record<string, string> {
  const key = apiKey?.trim();
  if (!key) return {};

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  if (new URL(baseUrl).hostname === GEMINI_API_HOST) {
    headers["x-goog-api-key"] = key;
  }
  return headers;
}

export function buildGeminiApiKeyHeaders(
  apiKey?: string,
): Record<string, string> {
  const key = apiKey?.trim();
  return key ? { "x-goog-api-key": key } : {};
}
