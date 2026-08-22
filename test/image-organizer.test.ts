import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImageOrganizer, IMAGE_EXTS } from "../src/core/imageOrganizer";
import { makeFakePlugin, makeFakeApp, TFile, TFolder } from "./helpers";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("IMAGE_EXTS", () => {
  it("包含常见图片扩展名", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"]) {
      expect(IMAGE_EXTS.has(ext)).toBe(true);
    }
  });
});

describe("ImageOrganizer.extractImageRefs", () => {
  let plugin: ReturnType<typeof makeFakePlugin>;
  let app: ReturnType<typeof makeFakeApp>;

  beforeEach(() => {
    app = makeFakeApp({
      files: {
        "a.md": "",
        "attachments/photo.png": "",
        "attachments/pic.jpg": "",
        "notes/other.md": "",
      },
    });
    plugin = makeFakePlugin({ app });
  });

  it("提取 wiki 嵌入图片", () => {
    const content = "看这张图：![[photo.png]] 还有 ![[pic.jpg|300]]";
    const files = new ImageOrganizer(plugin).extractImageRefs(content, "a.md");
    expect(files.map((f) => f.path).sort()).toEqual(["attachments/photo.png", "attachments/pic.jpg"]);
  });

  it("提取 markdown 图片", () => {
    const content = "![说明](attachments/photo.png) 与 ![](attachments/pic.jpg)";
    const files = new ImageOrganizer(plugin).extractImageRefs(content, "a.md");
    expect(files).toHaveLength(2);
  });

  it("跳过 http/data URI 外部图片", () => {
    const content = "![外链](https://example.com/x.png) ![数据](data:image/png;base64,xxx)";
    expect(new ImageOrganizer(plugin).extractImageRefs(content, "a.md")).toHaveLength(0);
  });

  it("跳过非图片文件", () => {
    const content = "![[notes/other]] 引用 md 笔记";
    expect(new ImageOrganizer(plugin).extractImageRefs(content, "a.md")).toHaveLength(0);
  });

  it("去重相同图片", () => {
    const content = "![[photo.png]] 再次 ![[photo.png]]";
    expect(new ImageOrganizer(plugin).extractImageRefs(content, "a.md")).toHaveLength(1);
  });
});

describe("ImageOrganizer.targetFolderFor", () => {
  it("默认根目录 + 按笔记分子文件夹", () => {
    const plugin = makeFakePlugin();
    const note = new TFile("notes/我的笔记.md");
    const org = new ImageOrganizer(plugin);
    expect(org.targetFolderFor(note)).toBe("attachments/我的笔记");
  });

  it("关闭子文件夹时只用根目录", () => {
    const plugin = makeFakePlugin({
      settings: { imageOrg: { ...DEFAULT_SETTINGS.imageOrg, subfolderPerNote: false } },
    });
    const org = new ImageOrganizer(plugin);
    expect(org.targetFolderFor(new TFile("notes/a.md"))).toBe("attachments");
  });

  it("folderOverride 优先", () => {
    const plugin = makeFakePlugin();
    const org = new ImageOrganizer(plugin);
    expect(org.targetFolderFor(new TFile("notes/a.md"), "自定义目录/")).toBe("自定义目录");
  });

  it("非法字符被清理", () => {
    const plugin = makeFakePlugin();
    const org = new ImageOrganizer(plugin);
    // 只取 basename（b:c）做子文件夹名
    expect(org.targetFolderFor(new TFile("notes/a/b:c.md"))).toBe("attachments/b-c");
  });
});

describe("ImageOrganizer.organizeNote", () => {
  it("移动图片并更新笔记链接", async () => {
    const app = makeFakeApp({
      files: {
        "notes/note.md": "![图](images/photo.png)",
        "images/photo.png": "PNGDATA",
      },
    });
    const plugin = makeFakePlugin({
      app,
      settings: {
        imageOrg: { ...DEFAULT_SETTINGS.imageOrg, checkOrphans: false, renameImages: false },
      },
    });
    const org = new ImageOrganizer(plugin);
    const note = app.vault.getMarkdownFiles()[0];
    const result = await org.organizeNote(note, { targetFolder: "attachments" });
    expect(result.movedCount).toBe(1);
    expect(result.items[0].newPath).toBe("attachments/photo.png");
    // 链接被更新
    expect(app.files["notes/note.md"]).toContain("attachments/photo.png");
  });

  it("重命名图片为 笔记名-N", async () => {
    const app = makeFakeApp({
      files: {
        "notes/note.md": "![[photo.png]]",
        "photo.png": "PNGDATA",
      },
    });
    const plugin = makeFakePlugin({
      app,
      settings: { imageOrg: { ...DEFAULT_SETTINGS.imageOrg, checkOrphans: false, renameImages: true } },
    });
    const org = new ImageOrganizer(plugin);
    const note = app.vault.getMarkdownFiles()[0];
    const result = await org.organizeNote(note, { targetFolder: "attachments" });
    expect(result.movedCount).toBe(1);
    expect(result.items[0].newPath).toMatch(/attachments\/note-1\.png/);
  });

  it("已在目标文件夹的图片不重复移动", async () => {
    const app = makeFakeApp({
      files: {
        "notes/note.md": "![[photo.png]]",
        "attachments/photo.png": "PNGDATA",
      },
    });
    const plugin = makeFakePlugin({
      app,
      settings: { imageOrg: { ...DEFAULT_SETTINGS.imageOrg, checkOrphans: false } },
    });
    const org = new ImageOrganizer(plugin);
    const note = app.vault.getMarkdownFiles()[0];
    const result = await org.organizeNote(note, { targetFolder: "attachments" });
    expect(result.movedCount).toBe(0);
    expect(result.items[0].moved).toBe(false);
  });
});

describe("ImageOrganizer.findOrphans", () => {
  it("找出未被引用的图片", async () => {
    const app = makeFakeApp({
      files: {
        "a.md": "![[used.png]]",
        "attachments/used.png": "1",
        "attachments/orphan.png": "2",
      },
    });
    const plugin = makeFakePlugin({ app });
    const org = new ImageOrganizer(plugin);
    const orphans = await org.findOrphans("attachments");
    expect(orphans.map((f) => f.path)).toEqual(["attachments/orphan.png"]);
  });
});
