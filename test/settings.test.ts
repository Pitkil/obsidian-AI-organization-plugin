import { describe, it, expect, vi, beforeEach } from "vitest";
import { deepMerge, DEFAULT_SETTINGS, loadSettings, normalizeSettings } from "../src/settings";
import { Plugin } from "obsidian";

describe("deepMerge", () => {
  it("浅层覆盖基础值", () => {
    const base = { a: 1, b: 2 };
    expect(deepMerge(base, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it("递归合并嵌套对象", () => {
    const base = { chat: { systemPrompt: "默认", saveFolder: "AI 对话" } };
    const merged = deepMerge(base, { chat: { systemPrompt: "自定义" } });
    expect(merged).toEqual({ chat: { systemPrompt: "自定义", saveFolder: "AI 对话" } });
  });

  it("数组直接整体替换（不合并）", () => {
    const base = { tags: ["a", "b"] };
    expect(deepMerge(base, { tags: ["c"] })).toEqual({ tags: ["c"] });
  });

  it("undefined 不覆盖已有值", () => {
    const base = { a: 1 };
    expect(deepMerge(base, { a: undefined } as any)).toEqual({ a: 1 });
  });

  it("新增字段默认值保留", () => {
    const merged = deepMerge(DEFAULT_SETTINGS, {
      openaiCompatible: { baseUrl: "http://localhost:11434/v1" },
    });
    expect(merged.openaiCompatible.baseUrl).toBe("http://localhost:11434/v1");
    expect(merged.openaiCompatible.apiKey).toBe("");
    expect(merged.formatting.mode).toBe("full");
    expect(merged.annotations).toEqual([]);
  });
});

describe("loadSettings", () => {
  let plugin: Plugin;

  beforeEach(() => {
    plugin = new Plugin() as any;
  });

  it("无数据时返回默认设置", async () => {
    plugin.loadData = vi.fn(async () => ({}));
    const settings = await loadSettings(plugin as any);
    expect(settings.formatting.mode).toBe("full");
    expect(settings.imageOrg.attachmentRoot).toBe("attachments");
    expect(settings.scrollRestore.enabled).toBe(true);
    expect(settings.scrollRestore.positions).toEqual({});
  });

  it("合并用户已保存的设置", async () => {
    plugin.loadData = vi.fn(async () => ({
      formatting: { mode: "spacing" },
      imageOrg: { attachmentRoot: "图片" },
      scrollRestore: {
        enabled: false,
        positions: { "a.md": { top: 120, line: 5, ch: 3 } },
      },
    }));
    const settings = await loadSettings(plugin as any);
    expect(settings.formatting.mode).toBe("spacing");
    expect(settings.imageOrg.attachmentRoot).toBe("图片");
    expect(settings.imageOrg.subfolderPerNote).toBe(true); // 默认值保留
    // 浏览位置持久化：跨重启恢复
    expect(settings.scrollRestore.enabled).toBe(false);
    expect(settings.scrollRestore.positions["a.md"]).toEqual({ top: 120, line: 5, ch: 3 });
  });

  it("旧数据没有 positions 字段时归一化为空对象", async () => {
    plugin.loadData = vi.fn(async () => ({
      scrollRestore: { enabled: true }, // 旧格式：无 positions
    }));
    const settings = await loadSettings(plugin as any);
    expect(settings.scrollRestore.positions).toEqual({});
  });

  it("过滤非法便签", async () => {
    plugin.loadData = vi.fn(async () => ({
      annotations: [
        { id: "1", filePath: "a.md", quote: "有效", type: "thought" },
        { id: "2" }, // 缺字段
        null, // 空对象
      ],
    }));
    const settings = await loadSettings(plugin as any);
    expect(settings.annotations).toHaveLength(1);
    expect(settings.annotations[0].id).toBe("1");
  });
});

describe("normalizeSettings", () => {
  it("保留 anchorLost 字段（不误删便签）", () => {
    const raw = deepMerge(DEFAULT_SETTINGS, {
      annotations: [
        {
          id: "a1",
          filePath: "n.md",
          quote: "某段文字",
          type: "thought",
          anchorLost: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    } as any);
    const s = normalizeSettings(raw);
    expect(s.annotations).toHaveLength(1);
    expect(s.annotations[0].anchorLost).toBe(true);
  });

  it("补全模型 profile 默认字段", () => {
    const raw = deepMerge(DEFAULT_SETTINGS, {
      modelProfiles: [{ providerId: "openaiCompatible", model: "gpt-4o" }],
    } as any);
    const s = normalizeSettings(raw);
    expect(s.modelProfiles[0].enabled).toBe(true);
    expect(s.modelProfiles[0].kind).toBe("text");
    expect(s.modelProfiles[0].id).toBeTruthy();
  });
});
