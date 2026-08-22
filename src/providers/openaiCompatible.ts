import type { ChatContent, ChatMessage, ChatOptions, ModelProvider, ProviderId } from "../types";
import {
  AIRequestError,
  buildHeaders,
  errorMessage,
  postJson,
  parseNonStreamJson,
  readErrorText,
} from "./http";

// ============================================================
// OpenAI 兼容提供商
// 覆盖：OpenAI / DeepSeek / 通义千问 / 智谱 GLM / Kimi(Moonshot) / Ollama / 本地 vLLM 等
// ============================================================

interface OpenAIConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: ProviderId = "openaiCompatible";
  readonly label = "OpenAI 兼容接口";

  constructor(private config: () => OpenAIConfig) {}

  isConfigured(): boolean {
    const c = this.config();
    if (!c.enabled || !c.baseUrl || !c.model) return false;
    if (c.apiKey) return true;
    return isLocalEndpoint(c.baseUrl);
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const c = this.config();
    const baseUrl = (options.baseUrl || c.baseUrl).replace(/\/+$/, "");
    const apiKey = options.apiKey ?? c.apiKey;
    const body: Record<string, unknown> = {
      model: options.model || c.model,
      messages: messages.map((message) => ({
        role: message.role,
        content: toOpenAIContent(message.content),
      })),
      temperature: options.temperature ?? c.temperature,
      max_tokens: options.maxTokens ?? c.maxTokens,
    };

    if (options.onStream) {
      const res = await this.post(`${baseUrl}/chat/completions`, body, apiKey);
      if (!res.ok) throw new AIRequestError(readErrorText(res), res.status);
      const text = parseNonStreamJson(res.json);
      options.onStream(text);
      return text;
    }

    const res = await this.post(`${baseUrl}/chat/completions`, body, apiKey);
    if (!res.ok) {
      throw new AIRequestError(readErrorText(res), res.status);
    }
    return parseNonStreamJson(res.json);
  }

  private async post(
    url: string,
    body: Record<string, unknown>,
    apiKey: string
  ): ReturnType<typeof postJson> {
    const headers = buildHeaders(apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
    try {
      return postJson(url, body, headers);
    } catch (err: unknown) {
      throw new AIRequestError(`网络请求失败：${errorMessage(err)}`);
    }
  }
}

function toOpenAIContent(content: ChatContent): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    return {
      type: "image_url",
      image_url: { url: `data:${part.mimeType};base64,${part.data}` },
    };
  });
}

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}
