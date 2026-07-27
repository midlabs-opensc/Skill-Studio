import type { ProviderKind } from "../types";

export interface ProviderErrorPresentation {
  summary: string;
  detail: string;
  recognized: boolean;
}

export function presentProviderError(
  error: unknown,
  provider?: ProviderKind,
): ProviderErrorPresentation {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status)
      : Number(normalized.match(/http\s+(\d{3})/)?.[1]);

  if (
    normalized.includes("model not found") ||
    normalized.includes("model_not_found") ||
    normalized.includes("unknown model") ||
    normalized.includes("does not exist or you do not have access")
  ) {
    return {
      summary:
        "The selected model could not be found. Check the model name or refresh the available model list in Settings.",
      detail,
      recognized: true,
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    normalized.includes("invalid api key") ||
    normalized.includes("api key not valid") ||
    normalized.includes("invalid authorization header") ||
    normalized.includes("missing or invalid authorization header") ||
    normalized.includes("authentication failed")
  ) {
    return {
      summary:
        "The provider rejected this request. Check the API key and your permission to use this model.",
      detail,
      recognized: true,
    };
  }
  if (
    status === 429 ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("quota exceeded")
  ) {
    return {
      summary:
        "The provider request limit was reached. Wait a moment and try again, or check the account quota.",
      detail,
      recognized: true,
    };
  }
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    normalized.includes("high demand") ||
    normalized.includes("overloaded") ||
    normalized.includes("capacity")
  ) {
    return {
      summary:
        "The model is temporarily busy or unavailable. Wait a short time and try again.",
      detail,
      recognized: true,
    };
  }
  if (
    status === 408 ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("deadline exceeded")
  ) {
    return {
      summary:
        "The provider took too long to respond. Try again or increase the timeout in Settings.",
      detail,
      recognized: true,
    };
  }
  if (
    normalized.includes("context length") ||
    normalized.includes("context window") ||
    normalized.includes("too many tokens") ||
    normalized.includes("maximum token")
  ) {
    return {
      summary:
        "The request is too long for this model. Shorten the conversation or current file and try again.",
      detail,
      recognized: true,
    };
  }
  if (
    normalized.includes("invalid json") ||
    normalized.includes("contained no message") ||
    normalized.includes("unexpected response")
  ) {
    return {
      summary:
        "The provider returned a response Skill Studio could not read. Try again; if it continues, check the endpoint and model settings.",
      detail,
      recognized: true,
    };
  }
  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network request failed") ||
    normalized.includes("connection refused") ||
    normalized.includes("dns") ||
    normalized.includes("certificate") ||
    normalized.includes("tls") ||
    normalized.includes("error sending request") ||
    normalized.includes("could not connect")
  ) {
    return {
      summary:
        provider === "ollama"
          ? "The local Ollama service could not be reached. Make sure Ollama is running and its address is correct."
          : "The provider could not be reached. Check the endpoint, network connection, and browser CORS permissions.",
      detail,
      recognized: true,
    };
  }
  return { summary: detail, detail, recognized: false };
}
