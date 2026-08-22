import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatService } from "../src/core/chatService";
import { FormattingService } from "../src/core/formatting";
import { TextEditor } from "../src/core/textEditor";
import { Translator } from "../src/core/translator";
import { MetadataGenerator } from "../src/core/metadataGenerator";
import { BatchProcessor } from "../src/core/batchProcessor";
import { makeFakePlugin, makeFakeApp, TFile } from "./helpers";
import { DEFAULT_SETTINGS } from "../src/settings";

// ============================================================
// ChatService
// ============================================================
describe("ChatService.buildMessages", () => {
  it("无上下文时只有 system + user", () => {
    const plugin = makeFakePlugin();
    const svc = new ChatService(plugin);
    const messages = svc.buildMessages("你好");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "你好" });
  });

  it("注入笔记上下文与选中文本", () => {
    const plugin = makeFakePlugin();
    const svc = new ChatService(plugin);
    const messages = svc.buildMessages("总结一下", {
      noteContext: { name: "test.md", content: "这是笔记内容" },
      selection: "选中的文字",
    });
    const user = messages[1].content as string;
    expect(user).toContain("【当前笔记：test.md】");
    expect(user).toContain("这是笔记内容");
    expect(user).toContain("【用户选中文本】");
    expect(user).toContain("选中的文字");
    expect(user).toContain("【我的问题】");
  });

  it("追加额外系统指令", () => {
    const plugin = makeFakePlugin();
    const svc = new ChatService(plugin);
    const messages = svc.buildMessages("hi", { extraSystem: "只输出 JSON" });
    expect(messages[0].content).toContain("只输出 JSON");
  });

  it("超长笔记被截断", () => {
    const plugin = makeFakePlugin();
    const svc = new ChatService(plugin);
    const messages = svc.buildMessages("hi", {
      noteContext: { name: "big.md", content: "x".repeat(5000) },
    });
    expect((messages[1].content as string).length).toBeLessThan(5000);
  });
});

describe("ChatService.chat", () => {
  it("未配置任何提供商时抛错", async () => {
    const plugin = makeFakePlugin();
    plugin.providers = [];
    const svc = new ChatService(plugin);
    await expect(svc.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/未配置/);
  });

  it("使用传入的 provider 直接对话", async () => {
    const plugin = makeFakePlugin();
    const provider = {
      id: "openaiCompatible",
      label: "mock",
      isConfigured: () => true,
      chat: vi.fn(async () => "回复"),
    } as any;
    plugin.providers = [provider];
    const svc = new ChatService(plugin);
    const out = await svc.chat([{ role: "user", content: "hi" }], { provider });
    expect(out).toBe("回复");
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it("通过 profile 选择 provider", async () => {
    const plugin = makeFakePlugin({
      settings: {
        modelProfiles: [
          { id: "p1", providerId: "openaiCompatible", kind: "text", name: "p", enabled: true, apiKey: "k", model: "gpt-4o", baseUrl: "https://x/v1", temperature: 0.5, maxTokens: 1024 },
        ],
      },
    });
    const provider = {
      id: "openaiCompatible",
      label: "mock",
      isConfigured: () => true,
      chat: vi.fn(async () => "ok"),
    } as any;
    plugin.providers = [provider];
    const svc = new ChatService(plugin);
    const out = await svc.chat([{ role: "user", content: "hi" }], { profileId: "p1" });
    expect(out).toBe("ok");
    const opts = provider.chat.mock.calls[0][1];
    expect(opts.model).toBe("gpt-4o");
    expect(opts.apiKey).toBe("k");
  });
});

// ============================================================
// FormattingService
// ============================================================
describe("FormattingService", () => {
  it("去掉 AI 返回的代码围栏并保留换行", async () => {
    const plugin = makeFakePlugin({
      chatImpl: async () => "```markdown\n# 排版后\n\n正文\n```",
    });
    const svc = new FormattingService(plugin);
    const out = await svc.format("# 原文", "full");
    expect(out).toBe("# 排版后\n\n正文\n");
  });

  it("使用自定义模板的提示词", async () => {
    const plugin = makeFakePlugin({
      settings: {
        formatting: {
          mode: "my-template",
          previewBeforeApply: true,
          customTemplates: [{ name: "my-template", prompt: "请按我的风格排版" }],
        },
      },
      chatImpl: async () => "结果",
    });
    const svc = new FormattingService(plugin);
    const chatSpy = plugin.chatService.chat as any;
    await svc.format("内容", "my-template");
    const messages = chatSpy.mock.calls[0][0];
    // 模板提示词在 user 消息中（buildMessages 的第一参）
    expect(messages[1].content as string).toContain("请按我的风格排版");
  });

  it("模型连续返回空内容时抛错", async () => {
    const plugin = makeFakePlugin({ chatImpl: async () => "" });
    const svc = new FormattingService(plugin);
    await expect(svc.format("内容", "full")).rejects.toThrow(/未返回排版内容/);
    expect(plugin.chatService.chat).toHaveBeenCalledTimes(2);
    expect((plugin.chatService.chat as any).mock.calls[1][1].onStream).toBeTypeOf("function");
  });

  it("模型首次返回空内容时会自动用流式兜底", async () => {
    let calls = 0;
    const plugin = makeFakePlugin({
      chatImpl: async (_messages, options) => {
        calls += 1;
        if (calls === 1) return "";
        options?.onStream?.("流式兜底排版内容");
        return "";
      },
    });
    const svc = new FormattingService(plugin);
    await expect(svc.format("内容", "full")).resolves.toBe("流式兜底排版内容\n");
  });

  it("丢失图片引用时抛错", async () => {
    const plugin = makeFakePlugin({ chatImpl: async () => "没有图片了" });
    const svc = new FormattingService(plugin);
    await expect(svc.format("![图](a.png)\n\n内容", "full")).rejects.toThrow(/图片/);
  });

  it("排版时保护并还原图片与嵌入引用", async () => {
    const plugin = makeFakePlugin({
      chatImpl: async () => "# 标题\n\nAIO_IMAGE_REF_0\n\nAIO_IMAGE_REF_1\n\n正文",
    });
    const svc = new FormattingService(plugin);
    const out = await svc.format("# 标题\n\n![图](a.png)\n\n![[b.png]]\n\n正文", "full");
    expect(out).toContain("![图](a.png)");
    expect(out).toContain("![[b.png]]");
  });
});

// ============================================================
// TextEditor
// ============================================================
describe("TextEditor.transform", () => {
  it("润色：去掉围栏返回结果", async () => {
    const plugin = makeFakePlugin({ chatImpl: async () => "```\n润色后的文本\n```" });
    const svc = new TextEditor(plugin);
    const out = await svc.transform("原文", "polish");
    expect(out).toBe("润色后的文本");
  });

  it("四种操作都生成对应提示词", async () => {
    const markers: Record<string, string> = {
      polish: "润色",
      expand: "扩写",
      continue: "续写",
      summarize: "压缩",
    };
    for (const op of ["polish", "expand", "continue", "summarize"] as const) {
      const plugin = makeFakePlugin({ chatImpl: async () => "结果" });
      const svc = new TextEditor(plugin);
      await svc.transform("文本", op);
      const messages = (plugin.chatService.chat as any).mock.calls[0][0];
      // 操作提示词在 user 消息中，且包含对应的中文操作描述
      expect(messages[1].content as string).toContain(markers[op]);
    }
  });
});

// ============================================================
// Translator
// ============================================================
describe("Translator.translate", () => {
  it("提示词包含目标语言，返回去围栏文本", async () => {
    const plugin = makeFakePlugin({ chatImpl: async () => "```markdown\n译文\n```" });
    const svc = new Translator(plugin);
    const out = await svc.translate("Hello", "中文");
    expect(out).toBe("译文\n");

    const messages = (plugin.chatService.chat as any).mock.calls[0][0];
    expect(messages[0].content).toContain("中文");
  });
});

// ============================================================
// MetadataGenerator
// ============================================================
describe("MetadataGenerator", () => {
  it("解析 AI 返回的 JSON 并返回元数据", async () => {
    const app = makeFakeApp({ files: { "a.md": "# 标题\n内容" } });
    const plugin = makeFakePlugin({
      app,
      chatImpl: async () => '{"tags": ["标签1", "标签2"], "summary": "一句话", "aliases": ["别名"]}',
    });
    const svc = new MetadataGenerator(plugin);
    const meta = await svc.generate(app.vault.getMarkdownFiles()[0]);
    expect(meta.tags).toEqual(["标签1", "标签2"]);
    expect(meta.summary).toBe("一句话");
    expect(meta.aliases).toEqual(["别名"]);
  });

  it("标签数量受 maxTags 限制", async () => {
    const app = makeFakeApp({ files: { "a.md": "内容" } });
    const plugin = makeFakePlugin({
      app,
      settings: { metadata: { ...DEFAULT_SETTINGS.metadata, maxTags: 2 } },
      chatImpl: async () => '{"tags": ["1", "2", "3"]}',
    });
    const svc = new MetadataGenerator(plugin);
    const meta = await svc.generate(app.vault.getMarkdownFiles()[0]);
    expect(meta.tags).toHaveLength(2);
  });

  it("AI 返回非法内容时返回空元数据", async () => {
    const app = makeFakeApp({ files: { "a.md": "内容" } });
    const plugin = makeFakePlugin({ app, chatImpl: async () => "完全不是 JSON" });
    const svc = new MetadataGenerator(plugin);
    const meta = await svc.generate(app.vault.getMarkdownFiles()[0]);
    expect(meta).toEqual({ tags: [], summary: "", aliases: [] });
  });

  it("applyToNote 写入 frontmatter", async () => {
    const app = makeFakeApp({ files: { "a.md": "---\ntags: [旧]\n---\n正文" } });
    const plugin = makeFakePlugin({
      app,
      chatImpl: async () => '{"tags": ["新标签"], "summary": "摘要", "aliases": ["别名"]}',
    });
    const svc = new MetadataGenerator(plugin);
    const file = app.vault.getMarkdownFiles()[0];
    await svc.applyToNote(file);
    expect(app.files["a.md"]).toContain("新标签");
    expect(app.files["a.md"]).toContain("摘要");
  });
});

// ============================================================
// BatchProcessor
// ============================================================
describe("BatchProcessor.process", () => {
  it("格式化操作批量处理并跳过未变化文件", async () => {
    const app = makeFakeApp({ files: { "a.md": "原内容", "b.md": "原内容" } });
    const plugin = makeFakePlugin({
      app,
      chatImpl: async () => "排版后内容",
    });
    // 让 formatting 服务可被 batchProcessor 调用
    plugin.formatting = new FormattingService(plugin) as any;
    const files = app.vault.getMarkdownFiles();
    const svc = new BatchProcessor(plugin);
    const progress = vi.fn();
    const results = await svc.process(files, "format", progress);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(app.files["a.md"]).toContain("排版后内容");
    expect(progress).toHaveBeenCalled();
  });

  it("单文件失败时记录失败项并继续", async () => {
    const app = makeFakeApp({ files: { "a.md": "内容", "b.md": "内容" } });
    const plugin = makeFakePlugin({
      app,
      chatImpl: async (messages) => {
        // 第一个文件返回空 → format 校验失败
        throw new Error("模拟 AI 故障");
      },
    });
    plugin.formatting = new FormattingService(plugin) as any;
    const files = app.vault.getMarkdownFiles();
    const svc = new BatchProcessor(plugin);
    const results = await svc.process(files, "format", vi.fn());
    expect(results.filter((r) => !r.ok)).toHaveLength(2);
  });

  it("translate 操作调用翻译服务", async () => {
    const app = makeFakeApp({ files: { "a.md": "Hello" } });
    const plugin = makeFakePlugin({
      app,
      chatImpl: async () => "你好",
    });
    plugin.translator = new Translator(plugin) as any;
    const files = app.vault.getMarkdownFiles();
    const svc = new BatchProcessor(plugin);
    const results = await svc.process(files, "translate", vi.fn());
    expect(results[0].ok).toBe(true);
    expect(app.files["a.md"]).toContain("你好");
  });
});
