import type { ChatContent, ChatMessage, ChatOptions, ModelProvider, ProviderId } from "../types";
import {
  AIRequestError,
  buildHeaders,
  parseNonStreamJson,
  readErrorBody,
  streamLines,
} from "./http";

// ============================================================
// Anthropic Claude（原生 Messages API）
// ============================================================

interface AnthropicConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export class AnthropicProvider implements ModelProvider {
  readonly id: ProviderId = "anthropic";
  readonly label = "Anthropic Claude";

  constructor(private config: () => AnthropicConfig) {}

  isConfigured(): boolean {
    const c = this.config();
    return !!c.enabled && !!c.apiKey && !!c.model;
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const c = this.config();
    const apiKey = options.apiKey ?? c.apiKey;
    const url = this.endpoint(options.baseUrl);

    // Claude 的 system 是独立字段
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .map(toPlainText)
      .join("\n\n");
    const content = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: toAnthropicContent(m.content),
      }));

    const body: Record<string, unknown> = {
      model: options.model || c.model,
      max_tokens: options.maxTokens ?? c.maxTokens,
      temperature: options.temperature ?? c.temperature,
      messages: content,
    };
    if (system) body.system = system;

    if (options.onStream) {
      body.stream = true;
      const res = await this.post(url, body, apiKey, options);
      if (!res.ok) throw new AIRequestError(await readErrorBody(res), res.status);
      let full = "";
      await streamLines(res, (delta) => {
        full += delta;
        options.onStream?.(delta);
      }, options.signal);
      return full;
    }

    const res = await this.post(url, body, apiKey, options);
    if (!res.ok) throw new AIRequestError(await readErrorBody(res), res.status);
    const json = await res.json();
    return parseNonStreamJson(json);
  }

  private async post(
    url: string,
    body: Record<string, unknown>,
    apiKey: string,
    options: ChatOptions
  ): Promise<Response> {
    const headers = buildHeaders({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    });
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

  private endpoint(baseUrl?: string): string {
    const url = (baseUrl || ANTHROPIC_API).replace(/\/+$/, "");
    return url.endsWith("/messages") ? url : `${url}/messages`;
  }
}

function toAnthropicContent(content: ChatContent): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.mimeType,
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
