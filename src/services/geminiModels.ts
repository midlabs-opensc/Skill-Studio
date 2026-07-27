import type { ModelInfo } from "../types";

export const GEMINI_API_HOST = "generativelanguage.googleapis.com";
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash";

const FREE_MODEL_FALLBACKS = [
  GEMINI_DEFAULT_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

export function isGeminiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === GEMINI_API_HOST;
  } catch {
    return false;
  }
}

export function geminiModelsPageUrl(pageToken?: string): string {
  const url = new URL(`https://${GEMINI_API_HOST}/v1beta/models`);
  url.searchParams.set("pageSize", "1000");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}

export function parseGeminiModelsPage(value: unknown): {
  models: ModelInfo[];
  nextPageToken?: string;
} {
  const data = value as {
    models?: Array<{
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
    nextPageToken?: string;
  };
  const models = (data.models ?? [])
    .filter((model) =>
      model.supportedGenerationMethods?.includes("generateContent"),
    )
    .flatMap((model) => {
      const id = model.name?.replace(/^models\//, "");
      return id ? [{ id, name: model.displayName || id }] : [];
    });
  return {
    models,
    nextPageToken: data.nextPageToken || undefined,
  };
}

export function chooseGeminiDefaultModel(models: ModelInfo[]): string | undefined {
  const ids = new Set(models.map((model) => model.id));
  return (
    FREE_MODEL_FALLBACKS.find((model) => ids.has(model)) ??
    models.find(
      (model) =>
        model.id.includes("flash") && !model.id.includes("embedding"),
    )?.id ??
    models[0]?.id
  );
}
