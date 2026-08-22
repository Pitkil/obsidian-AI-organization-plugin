import type { ChatOptions } from "../types";

// ============================================================
// 通用 HTTP / 流式解析工具
// ============================================================

export class AIRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AIRequestError";
    this.status = status;
  }
}

/**
 * 解析 SSE / NDJSON 流。
 * 支持 OpenAI 风格 `data: {...}` 行，也支持裸 JSON 行（如 Ollama）。
 * 每解析出一个增量就调用 onDelta。
 */
export async function streamLines(
  response: Response,
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!response.body) {
    throw new AIRequestError("响应没有可读流");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith(":")) return; // SSE 注释/心跳

    let data = line;
    if (data.startsWith("data:")) {
      data = data.slice(5).trim();
    }
    if (data === "[DONE]") return;

    // 尝试解析 JSON（有些流是 [{...},{...}] 数组，取最后一个元素）
    try {
      let json: any = null;
      if (data.startsWith("[")) {
        const arr = JSON.parse(data);
        json = Array.isArray(arr) ? arr[arr.length - 1] : arr;
      } else {
        json = JSON.parse(data);
      }
      const delta = extractDelta(json);
      if (delta) onDelta(delta);
    } catch {
      // 不是 JSON，忽略
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按行切分
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        processLine(rawLine);
      }
    }
    if (buffer.trim()) {
      processLine(buffer);
    }
  } catch (err) {
    if (signal?.aborted) return; // 主动取消，不报错
    throw err;
  }
}

/** 兼容多种流式格式，抽取文本增量 */
export function extractDelta(json: any): string | null {
  if (!json || typeof json !== "object") return null;

  // OpenAI / DeepSeek / 通义 / 智谱 / Kimi
  const choices = json.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const c = choices[0];
    const delta = c.delta;
    if (delta && typeof delta.content === "string" && delta.content) return delta.content;
    if (delta && Array.isArray(delta.content)) return textFromContentBlocks(delta.content);
    if (typeof c.text === "string" && c.text) return c.text; // 兼容 completions
    if (typeof c.message?.content === "string" && c.message.content) return c.message.content;
    if (Array.isArray(c.message?.content)) return textFromContentBlocks(c.message.content);
  }

  // Anthropic stream: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
  if (json.type === "content_block_delta" && typeof json.delta?.text === "string") {
    return json.delta.text;
  }

  // Ollama (ndjson): {"message":{"content":"..."}}
  if (json.message && typeof json.message.content === "string" && json.message.content) {
    return json.message.content;
  }

  // Gemini SSE: data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
  const candidates = json.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const parts = candidates[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
      if (text) return text;
    }
  }

  return null;
}

/** 统一的非流式响应解析 */
export function parseNonStreamJson(json: any): string {
  // OpenAI
  const choices = json?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const msg = choices[0]?.message;
    if (typeof msg?.content === "string" && msg.content) return msg.content;
    if (Array.isArray(msg?.content)) {
      const text = textFromContentBlocks(msg.content);
      if (text) return text;
    }
    if (typeof choices[0]?.text === "string" && choices[0].text) return choices[0].text;
    const finishReason = choices[0]?.finish_reason;
    if (finishReason === "length") {
      throw new AIRequestError("模型输出被 Max Token 截断，未返回正文内容。请调大 Max Token 后重试。");
    }
  }
  // Ollama
  if (typeof json?.message?.content === "string") return json.message.content;
  if (typeof json?.response === "string") return json.response;
  // Anthropic: { content: [{ type: "text", text: "..." }, ...] }
  if (Array.isArray(json?.content)) {
    const text = json.content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("");
    if (text) return text;
  }
  // Gemini
  const candidates = json?.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const parts = candidates[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
      if (text) return text;
    }
  }
  throw new AIRequestError("无法从响应中解析出文本内容，请检查模型返回格式");
}

function textFromContentBlocks(blocks: any[]): string {
  return blocks
    .map((block) => {
      if (typeof block === "string") return block;
      if (typeof block?.text === "string") return block.text;
      if (typeof block?.content === "string") return block.content;
      return "";
    })
    .join("");
}

/** 读取错误响应体（尽量给出可读信息） */
export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      return j?.error?.message || j?.message || text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return res.statusText || "未知错误";
  }
}

export function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}
