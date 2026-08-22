import { describe, it, expect, vi, beforeEach } from "vitest";
import { InboxOrganizer } from "../src/core/inboxOrganizer";
import { LinkSuggester } from "../src/core/linkSuggester";
import { makeFakePlugin, makeFakeApp, TFile } from "./helpers";
import { DEFAULT_SETTINGS } from "../src/settings";

// ============================================================
// InboxOrganizer
// ============================================================
describe("InboxOrganizer.listInboxNotes", () => {
  it("只返回收件箱目录下的 md 文件", () => {
    const app = makeFakeApp({
      files: {
        "Inbox/草稿1.md": "内容",
        "Inbox/草稿2.md": "内容",
        "Projects/正式.md": "内容",
      },
    });
    const plugin = makeFakePlugin({ app, settings: { inbox: { ...DEFAULT_SETTINGS.inbox, inboxFolder: "Inbox" } } });
    const svc = new InboxOrganizer(plugin);
    const notes = svc.listInboxNotes();
    expect(notes.map((n) => n.name).sort()).toEqual(["草稿1.md", "草稿2.md"]);
  });

  it("收件箱目录不存在时返回空", () => {
    const app = makeFakeApp({ files: { "a.md": "" } });
    const plugin = makeFakePlugin({ app, settings: { inbox: { ...DEFAULT_SETTINGS.inbox, inboxFolder: "不存在" } } });
    const svc = new InboxOrganizer(plugin);
    expect(svc.listInboxNotes()).toHaveLength(0);
  });
});

describe("InboxOrganizer.suggestMoves", () => {
  it("解析 AI 返回的 JSON 并过滤未知文件", async () => {
    const app = makeFakeApp({
      files: {
        "Inbox/草稿1.md": "关于项目A的计划",
        "Inbox/草稿2.md": "会议记录",
        "项目/文档.md": "x",
      },
    });
    const plugin = makeFakePlugin({
      app,
      settings: { inbox: { ...DEFAULT_SETTINGS.inbox, inboxFolder: "Inbox" } },
      chatImpl: async () =>
        '[{"fileName": "草稿1.md", "targetFolder": "项目", "reason": "属于项目"}, {"fileName": "不存在.md", "targetFolder": "x", "reason": "会被过滤"}]',
    });
    const svc = new InboxOrganizer(plugin);
    const suggestions = await svc.suggestMoves(svc.listInboxNotes());
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ fileName: "草稿1.md", targetFolder: "项目" });
  });

  it("路径规范化：去掉首尾斜杠", async () => {
    const app = makeFakeApp({ files: { "Inbox/a.md": "x" } });
    const plugin = makeFakePlugin({
      app,
      settings: { inbox: { ...DEFAULT_SETTINGS.inbox, inboxFolder: "Inbox" } },
      chatImpl: async () => '[{"fileName": "a.md", "targetFolder": "/项目/会议/", "reason": "r"}]',
    });
    const svc = new InboxOrganizer(plugin);
    const suggestions = await svc.suggestMoves(svc.listInboxNotes());
    expect(suggestions[0].targetFolder).toBe("项目/会议");
  });

  it("AI 返回非数组时抛错", async () => {
    const app = makeFakeApp({ files: { "Inbox/a.md": "x" } });
    const plugin = makeFakePlugin({
      app,
      settings: { inbox: { ...DEFAULT_SETTINGS.inbox, inboxFolder: "Inbox" } },
      chatImpl: async () => "不是 JSON",
    });
    const svc = new InboxOrganizer(plugin);
    await expect(svc.suggestMoves(svc.listInboxNotes())).rejects.toThrow(/无法解析/);
  });
});

describe("InboxOrganizer.executeMoves", () => {
  it("执行移动并统计 moved/kept", async () => {
    const app = makeFakeApp({ files: { "Inbox/草稿.md": "内容", "Inbox/保持.md": "内容" } });
    const plugin = makeFakePlugin({
      app,
      settings: { inbox: { ...DEFAULT_SETTINGS.inbox, inboxFolder: "Inbox" } },
    });
    const svc = new InboxOrganizer(plugin);
    const result = await svc.executeMoves([
      { fileName: "Inbox/草稿.md", targetFolder: "项目", reason: "r" },
      { fileName: "Inbox/保持.md", targetFolder: "", reason: "保持" },
    ]);
    expect(result).toEqual({ moved: 1, kept: 1 });
    expect(app.files["项目/草稿.md"]).toBe("内容");
    expect(app.files["Inbox/草稿.md"]).toBeUndefined();
    // 保持原位的文件未被移动
    expect(app.files["Inbox/保持.md"]).toBe("内容");
  });

  it("目标已存在时自动加序号避免覆盖", async () => {
    const app = makeFakeApp({
      files: { "Inbox/草稿.md": "新内容", "项目/草稿.md": "旧内容" },
    });
    const plugin = makeFakePlugin({
      app,
      settings: { inbox: { ...DEFAULT_SETTINGS.inbox, inboxFolder: "Inbox" } },
    });
    const svc = new InboxOrganizer(plugin);
    const result = await svc.executeMoves([{ fileName: "Inbox/草稿.md", targetFolder: "项目", reason: "r" }]);
    expect(result.moved).toBe(1);
    expect(app.files["项目/草稿 (1).md"]).toBe("新内容");
  });
});

// ============================================================
// LinkSuggester
// ============================================================
describe("LinkSuggester.suggest", () => {
  it("过滤掉不在候选中的路径", async () => {
    const app = makeFakeApp({
      files: {
        "current.md": "# 当前\n关于 TypeScript",
        "notes/typescript.md": "# TS 笔记\n内容",
        "notes/vue.md": "# Vue 笔记\n内容",
      },
    });
    const plugin = makeFakePlugin({
      app,
      chatImpl: async () =>
        '[{"path": "notes/typescript.md", "reason": "相关"}, {"path": "notes/不存在.md", "reason": "会被过滤"}]',
    });
    const svc = new LinkSuggester(plugin);
    const current = app.vault.getMarkdownFiles().find((f) => f.path === "current.md")!;
    const suggestions = await svc.suggest(current);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].path).toBe("notes/typescript.md");
    expect(suggestions[0].basename).toBe("typescript");
  });

  it("AI 返回非数组时返回空数组", async () => {
    const app = makeFakeApp({ files: { "a.md": "内容", "b.md": "内容" } });
    const plugin = makeFakePlugin({ app, chatImpl: async () => "无结果" });
    const svc = new LinkSuggester(plugin);
    const current = app.vault.getMarkdownFiles().find((f) => f.path === "a.md")!;
    expect(await svc.suggest(current)).toEqual([]);
  });

  it("按标题相似度给候选打分排序", async () => {
    const app = makeFakeApp({
      files: {
        "typescript-guide.md": "# TS",
        "typescript-api.md": "# TS API",
        "unrelated.md": "# 其他",
      },
    });
    const plugin = makeFakePlugin({
      app,
      chatImpl: async () => "[]",
    });
    const svc = new LinkSuggester(plugin);
    const current = app.vault.getMarkdownFiles().find((f) => f.path === "typescript-guide.md")!;
    // 只验证能正常运行并返回空（candidates 内部已按分数排序）
    expect(await svc.suggest(current)).toEqual([]);
  });
});

describe("LinkSuggester.appendLinks", () => {
  it("把建议链接追加到笔记末尾", async () => {
    const app = makeFakeApp({ files: { "a.md": "# 标题\n正文" } });
    const plugin = makeFakePlugin({ app });
    const svc = new LinkSuggester(plugin);
    const file = app.vault.getMarkdownFiles()[0];
    const count = await svc.appendLinks(file, [
      { path: "b.md", basename: "b", reason: "相关" },
      { path: "c.md", basename: "c", reason: "" },
    ]);
    expect(count).toBe(2);
    expect(app.files["a.md"]).toContain("## 相关笔记");
    expect(app.files["a.md"]).toContain("[[b]] — 相关");
    expect(app.files["a.md"]).toContain("[[c]]");
  });

  it("空建议不修改笔记", async () => {
    const app = makeFakeApp({ files: { "a.md": "# 标题" } });
    const plugin = makeFakePlugin({ app });
    const svc = new LinkSuggester(plugin);
    const file = app.vault.getMarkdownFiles()[0];
    const count = await svc.appendLinks(file, []);
    expect(count).toBe(0);
    expect(app.files["a.md"]).toBe("# 标题");
  });
});
