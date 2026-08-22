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
// Google Gemini（原生 GenerateContent API）
// ============================================================

interface GeminiConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements ModelProvider {
  readonly id: ProviderId = "gemini";
  readonly label = "Google Gemini";

  constructor(private config: () => GeminiConfig) {}

  isConfigured(): boolean {
    const c = this.config();
    return !!c.enabled && !!c.apiKey && !!c.model;
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const c = this.config();
    const model = options.model || c.model;
    const apiKey = options.apiKey ?? c.apiKey;
    const baseUrl = (options.baseUrl || GEMINI_BASE).replace(/\/+$/, "");

    // Gemini 的 systemInstruction 是独立字段
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .map(toPlainText)
      .join("\n\n");

    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: toGeminiParts(m.content),
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? c.temperature,
        maxOutputTokens: options.maxTokens ?? c.maxTokens,
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      apiKey
    )}`;

    if (options.onStream) {
      const res = await this.post(url, body, options);
      if (!res.ok) throw new AIRequestError(readErrorText(res), res.status);
      const text = parseNonStreamJson(res.json);
      options.onStream(text);
      return text;
    }

    const nonStreamUrl = `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;
    const res = await this.post(nonStreamUrl, body, options);
    if (!res.ok) throw new AIRequestError(readErrorText(res), res.status);
    return parseNonStreamJson(res.json);
  }

  private async post(url: string, body: Record<string, unknown>, options: ChatOptions): ReturnType<typeof postJson> {
    const headers = buildHeaders();
    if (options.signal?.aborted) throw new AIRequestError("已取消");
    try {
      return postJson(url, body, headers);
    } catch (err: unknown) {
      throw new AIRequestError(`网络请求失败：${errorMessage(err)}`);
    }
  }
}

function toGeminiParts(content: ChatContent): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => {
    if (part.type === "text") return { text: part.text };
    return {
      inlineData: {
        mimeType: part.mimeType,
        data: part.data,
      },
    };
  });
}

function toPlainText(content: ChatContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : `[图片：${part.name || part.mimeType}]`))
    .join("\n");
}
