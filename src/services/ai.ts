import { invoke } from "@tauri-apps/api/core";
import type {
  ChatRequest,
  ChatResult,
  ModelInfo,
  ModelProvider,
  ProviderSettings,
  ProviderStatus,
} from "../types";
import { normalizeBaseUrl } from "../lib/validation";
import {
  buildGeminiApiKeyHeaders,
  buildProviderAuthHeaders,
} from "./providerAuth";
import {
  geminiModelsPageUrl,
  isGeminiBaseUrl,
  parseGeminiModelsPage,
} from "./geminiModels";

export class ProviderError extends Error {
  constructor(
    public code: "config" | "timeout" | "network" | "auth" | "response",
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
export const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let sessionApiKey = "";
export const setSessionApiKey = (key: string) => {
  sessionApiKey = key.trim();
};
export const getSessionApiKey = () => sessionApiKey;

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok)
      throw new ProviderError(
        response.status === 401 || response.status === 403
          ? "auth"
          : "response",
        `Provider returned HTTP ${response.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
        response.status,
      );
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError("response", "Provider returned invalid JSON.");
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ProviderError(
        "timeout",
        `Request timed out after ${timeoutMs}ms.`,
      );
    throw new ProviderError(
      "network",
      error instanceof Error ? error.message : "Network request failed.",
    );
  } finally {
    window.clearTimeout(timer);
  }
}
function config(settings: ProviderSettings, apiKey = sessionApiKey) {
  const normalizedApiKey = apiKey.trim();
  return {
    provider: settings.kind,
    baseUrl: normalizeBaseUrl(settings.baseUrl, settings.kind),
    model: settings.model,
    timeoutMs: settings.timeoutMs,
    apiKey: normalizedApiKey || null,
  };
}

export const aiProvider: ModelProvider = {
  async status(settings, apiKey) {
    if (isTauri())
      return invoke("provider_status", { config: config(settings, apiKey) });
    const models = await this.listModels(settings, apiKey);
    return {
      connected: true,
      provider: settings.kind,
      message: `${models.length} model available`,
    };
  },
  async listModels(settings, apiKey) {
    if (isTauri())
      return invoke<ModelInfo[]>("list_models", {
        config: config(settings, apiKey),
      });
    const base = normalizeBaseUrl(settings.baseUrl, settings.kind);
    const key = apiKey || sessionApiKey;
    if (isGeminiBaseUrl(base)) {
      const headers = buildGeminiApiKeyHeaders(key);
      const models: ModelInfo[] = [];
      let pageToken: string | undefined;
      do {
        const page = parseGeminiModelsPage(
          await requestJson(
            geminiModelsPageUrl(pageToken),
            { headers },
            settings.timeoutMs,
          ),
        );
        models.push(...page.models);
        pageToken = page.nextPageToken;
      } while (pageToken);
      return Array.from(
        new Map(models.map((model) => [model.id, model])).values(),
      ).sort((left, right) => left.id.localeCompare(right.id));
    }
    const headers = buildProviderAuthHeaders(base, key);
    const data = (await requestJson(
      `${base}${settings.kind === "ollama" ? "/api/tags" : "/models"}`,
      { headers },
      settings.timeoutMs,
    )) as { models?: { name: string }[]; data?: { id: string }[] };
    return settings.kind === "ollama"
      ? (data.models ?? []).map((x) => ({ id: x.name, name: x.name }))
      : (data.data ?? []).map((x) => ({ id: x.id, name: x.id }));
  },
  async chat(request) {
    const started = Date.now();
    if (isTauri())
      return invoke<ChatResult>("chat_model", {
        config: config(request.provider, request.apiKey),
        messages: request.messages,
        temperature: request.temperature ?? null,
      });
    const base = normalizeBaseUrl(
      request.provider.baseUrl,
      request.provider.kind,
    );
    const key = request.apiKey || sessionApiKey;
    const ollama = request.provider.kind === "ollama";
    const data = (await requestJson(
      `${base}${ollama ? "/api/chat" : "/chat/completions"}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildProviderAuthHeaders(base, key),
        },
        body: JSON.stringify({
          model: request.provider.model,
          messages: request.messages,
          stream: false,
          temperature: request.temperature,
        }),
      },
      request.provider.timeoutMs,
    )) as {
      message?: { content?: string };
      choices?: { message?: { content?: string } }[];
      prompt_eval_count?: number;
      eval_count?: number;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = ollama
      ? data.message?.content
      : data.choices?.[0]?.message?.content;
    if (!content)
      throw new ProviderError(
        "response",
        "Provider response contained no message.",
      );
    return {
      content,
      model: request.provider.model,
      durationMs: Date.now() - started,
      promptTokens: data.prompt_eval_count ?? data.usage?.prompt_tokens,
      completionTokens: data.eval_count ?? data.usage?.completion_tokens,
      demo: false,
    };
  },
};
