import type { ChatContent, ChatMessage, ChatOptions, ModelProvider, ProviderId } from "../types";
import {
  AIRequestError,
  buildHeaders,
  parseNonStreamJson,
  readErrorBody,
  streamLines,
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

    // 流式
    if (options.onStream) {
      body.stream = true;
      const res = await this.fetch(`${baseUrl}/chat/completions`, body, apiKey, options);
      if (!res.ok) {
        throw new AIRequestError(await readErrorBody(res), res.status);
      }
      let full = "";
      await streamLines(res, (delta) => {
        full += delta;
        options.onStream?.(delta);
      }, options.signal);
      return full;
    }

    // 非流式
    const res = await this.fetch(`${baseUrl}/chat/completions`, body, apiKey, options);
    if (!res.ok) {
      throw new AIRequestError(await readErrorBody(res), res.status);
    }
    const json = await res.json();
    return parseNonStreamJson(json);
  }

  private async fetch(
    url: string,
    body: Record<string, unknown>,
    apiKey: string,
    options: ChatOptions
  ): Promise<Response> {
    const headers = buildHeaders(apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
    try {
      return await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err: any) {
      if (options.signal?.aborted) throw new AIRequestError("已取消");
      throw new AIRequestError(`网络请求失败：${err?.message || err}`);
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
