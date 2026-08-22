import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AIRequestError,
  buildHeaders,
  extractDelta,
  parseNonStreamJson,
  readErrorBody,
  streamLines,
} from "../src/providers/http";
import { OpenAICompatibleProvider } from "../src/providers/openaiCompatible";
import { AnthropicProvider } from "../src/providers/anthropic";
import { GeminiProvider } from "../src/providers/gemini";
import type { ChatMessage } from "../src/types";

describe("extractDelta", () => {
  it("解析 OpenAI 流式增量", () => {
    expect(extractDelta({ choices: [{ delta: { content: "你好" } }] })).toBe("你好");
  });

  it("解析 OpenAI completions text", () => {
    expect(extractDelta({ choices: [{ text: "完成" }] })).toBe("完成");
  });

  it("解析 Ollama ndjson", () => {
    expect(extractDelta({ message: { content: "ollama" } })).toBe("ollama");
  });

  it("解析 Gemini candidates", () => {
    expect(
      extractDelta({ candidates: [{ content: { parts: [{ text: "gem" }, { text: "ini" }] } }] })
    ).toBe("gemini");
  });

  it("无法识别返回 null", () => {
    expect(extractDelta({ foo: "bar" })).toBeNull();
    expect(extractDelta(null)).toBeNull();
  });
});

describe("parseNonStreamJson", () => {
  it("解析 OpenAI 响应", () => {
    expect(parseNonStreamJson({ choices: [{ message: { content: "ok" } }] })).toBe("ok");
  });

  it("解析 Ollama 响应", () => {
    expect(parseNonStreamJson({ message: { content: "ollama" } })).toBe("ollama");
    expect(parseNonStreamJson({ response: "ollama2" })).toBe("ollama2");
  });

  it("解析 Gemini 响应", () => {
    expect(
      parseNonStreamJson({ candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] })
    ).toBe("ab");
  });

  it("无法解析时抛错", () => {
    expect(() => parseNonStreamJson({})).toThrow(AIRequestError);
  });
});

describe("streamLines", () => {
  function makeSSEResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }

  it("累积 OpenAI 风格 SSE 增量", async () => {
    const deltas: string[] = [];
    await streamLines(makeSSEResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n", "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n", "data: [DONE]\n"]), (d) => deltas.push(d));
    expect(deltas).toEqual(["你", "好"]);
  });

  it("忽略心跳注释行与非 JSON 行", async () => {
    const deltas: string[] = [];
    await streamLines(makeSSEResponse([": keep-alive\n", "data: not-json\n", "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n"]), (d) => deltas.push(d));
    expect(deltas).toEqual(["x"]);
  });

  it("跨 chunk 的行也能正确拼接", async () => {
    const deltas: string[] = [];
    await streamLines(
      makeSSEResponse(["data: {\"choices\":[{\"delta\":{\"c", "ontent\":\"拼接\"}}]}\n"]),
      (d) => deltas.push(d)
    );
    expect(deltas).toEqual(["拼接"]);
  });

  it("无 body 时抛错", async () => {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, "body", { value: null });
    await expect(streamLines(res, vi.fn())).rejects.toThrow(AIRequestError);
  });
});

describe("buildHeaders / readErrorBody", () => {
  it("buildHeaders 带默认 Content-Type", () => {
    expect(buildHeaders()).toEqual({ "Content-Type": "application/json" });
    expect(buildHeaders({ Authorization: "Bearer x" })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer x",
    });
  });

  it("readErrorBody 提取 error.message", async () => {
    const res = new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
    expect(await readErrorBody(res)).toBe("rate limit");
  });

  it("readErrorBody 返回原始文本", async () => {
    const res = new Response("plain text", { status: 500 });
    expect(await readErrorBody(res)).toBe("plain text");
  });
});

describe("OpenAICompatibleProvider", () => {
  const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockJsonResponse(body: unknown, status = 200) {
    (fetch as any).mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    );
  }

  it("isConfigured 需要 enabled + baseUrl + model", () => {
    const p = new OpenAICompatibleProvider(() => ({ enabled: true, baseUrl: "https://x/v1", apiKey: "", model: "", temperature: 0.7, maxTokens: 1024 }));
    expect(p.isConfigured()).toBe(false);
    const p2 = new OpenAICompatibleProvider(() => ({ enabled: true, baseUrl: "https://x/v1", apiKey: "k", model: "gpt-4o", temperature: 0.7, maxTokens: 1024 }));
    expect(p2.isConfigured()).toBe(true);
  });

  it("本地端点无 key 也算已配置", () => {
    const p = new OpenAICompatibleProvider(() => ({ enabled: true, baseUrl: "http://localhost:11434/v1", apiKey: "", model: "llama3", temperature: 0.7, maxTokens: 1024 }));
    expect(p.isConfigured()).toBe(true);
  });

  it("非流式调用正确拼接 URL 与请求体", async () => {
    mockJsonResponse({ choices: [{ message: { content: "回复" } }] });
    const p = new OpenAICompatibleProvider(() => ({ enabled: true, baseUrl: "https://api.deepseek.com/v1/", apiKey: "sk-1", model: "deepseek-chat", temperature: 0.7, maxTokens: 1024 }));
    const out = await p.chat(messages, { model: "deepseek-chat", temperature: 0.5, maxTokens: 2048 });
    expect(out).toBe("回复");

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-1");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-chat");
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(2048);
    expect(body.messages[0].content).toBe("hi");
  });

  it("非 200 抛 AIRequestError", async () => {
    (fetch as any).mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }));
    const p = new OpenAICompatibleProvider(() => ({ enabled: true, baseUrl: "https://x/v1", apiKey: "k", model: "m", temperature: 0.7, maxTokens: 1024 }));
    await expect(p.chat(messages, { model: "m" })).rejects.toThrow(/bad key/);
  });
});

describe("AnthropicProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isConfigured 需要 key + model", () => {
    const p = new AnthropicProvider(() => ({ enabled: true, apiKey: "", model: "claude", temperature: 0.7, maxTokens: 1024 }));
    expect(p.isConfigured()).toBe(false);
    const p2 = new AnthropicProvider(() => ({ enabled: true, apiKey: "k", model: "claude-3-5", temperature: 0.7, maxTokens: 1024 }));
    expect(p2.isConfigured()).toBe(true);
  });

  it("system 独立字段 + 正确请求头", async () => {
    (fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "claude 回复" }] }), { status: 200 })
    );
    const p = new AnthropicProvider(() => ({ enabled: true, apiKey: "ak", model: "claude-3-5-sonnet", temperature: 0.7, maxTokens: 4096 }));
    const out = await p.chat(
      [
        { role: "system", content: "你是助手" },
        { role: "user", content: "你好" },
      ],
      { model: "claude-3-5-sonnet" }
    );
    expect(out).toBe("claude 回复");

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("ak");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body);
    expect(body.system).toBe("你是助手");
    expect(body.messages).toHaveLength(1);
  });

  it("endpoint 自动补 /messages", async () => {
    (fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: "text", text: "x" }] }), { status: 200 })
    );
    const p = new AnthropicProvider(() => ({ enabled: true, apiKey: "ak", model: "m", temperature: 0.7, maxTokens: 1024 }));
    await p.chat([{ role: "user", content: "hi" }], { model: "m", baseUrl: "https://proxy.example.com" });
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toBe("https://proxy.example.com/messages");
  });
});

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("key 放在 URL 且解析 candidates", async () => {
    (fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "gemini 回复" }] } }] }), { status: 200 })
    );
    const p = new GeminiProvider(() => ({ enabled: true, apiKey: "gk", model: "gemini-1.5-pro", temperature: 0.7, maxTokens: 1024 }));
    const out = await p.chat([{ role: "user", content: "hi" }], { model: "gemini-1.5-pro" });
    expect(out).toBe("gemini 回复");

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain("key=gk");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("isConfigured 需要 key + model", () => {
    const p = new GeminiProvider(() => ({ enabled: true, apiKey: "", model: "gemini", temperature: 0.7, maxTokens: 1024 }));
    expect(p.isConfigured()).toBe(false);
  });
});
