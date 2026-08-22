// ============================================================
// 测试辅助：构造假的插件实例与假的 vault
// 让各核心服务（只依赖 plugin 上的公开字段）可以被单元测试
// ============================================================
import { vi } from "vitest";
import type AIOrganizerPlugin from "../src/main";
import { DEFAULT_SETTINGS, type AIOrganizerSettings } from "../src/settings";
import { ChatService } from "../src/core/chatService";
// 从 "obsidian" 导入会被 vitest 别名拦截为 mock 类，保证与核心服务 instanceof 一致
import { TFile, TFolder, Notice } from "obsidian";

export type ChatMock = ReturnType<typeof vi.fn>;

export interface FakeVaultOptions {
  /** path -> content 的初始文件表 */
  files?: Record<string, string>;
}

/** 构建一个可调用的假 vault（路径映射到 TFile/TFolder） */
export function makeFakeApp(opts: FakeVaultOptions = {}) {
  const files: Record<string, string> = { ...(opts.files ?? {}) };
  const fileMap = new Map<string, TFile>();

  const ensureFile = (path: string): TFile => {
    if (!fileMap.has(path)) {
      const parts = path.split("/");
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
      const parent = parentPath ? new TFolder(parentPath) : null;
      fileMap.set(path, new TFile(path, parent));
    }
    return fileMap.get(path)!;
  };

  const vault = {
    files: [] as TFile[],
    read: vi.fn(async (file: TFile) => files[file.path] ?? ""),
    cachedRead: vi.fn(async (file: TFile) => files[file.path] ?? ""),
    modify: vi.fn(async (file: TFile, content: string) => {
      files[file.path] = content;
    }),
    getMarkdownFiles: vi.fn(() => Object.keys(files).filter((p) => p.endsWith(".md")).map(ensureFile)),
    getFiles: vi.fn(() => Object.keys(files).map(ensureFile)),
    getAbstractFileByPath: vi.fn((path: string) => {
      if (files[path] !== undefined) return ensureFile(path);
      // 文件夹：以该路径为前缀的文件存在即视为文件夹
      const prefix = path.endsWith("/") ? path : path + "/";
      if (Object.keys(files).some((p) => p.startsWith(prefix))) {
        return new TFolder(path);
      }
      return null;
    }),
    getAllLoadedFiles: vi.fn(() => {
      const dirs = new Set<string>();
      for (const p of Object.keys(files)) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }
      const folderMap = new Map<string, TFolder>();
      for (const d of Array.from(dirs)) folderMap.set(d, new TFolder(d));
      const fileObjs = Object.keys(files).map(ensureFile);
      // 填充每个文件夹的直接子文件
      for (const f of fileObjs) {
        if (f.parent && folderMap.has(f.parent.path)) {
          folderMap.get(f.parent.path)!.children.push(f);
        }
      }
      // 填充直接子文件夹
      for (const folder of Array.from(folderMap.values())) {
        const prefix = folder.path + "/";
        for (const childDir of Array.from(dirs)) {
          if (childDir.startsWith(prefix) && childDir !== folder.path) {
            const rest = childDir.slice(prefix.length);
            if (!rest.includes("/")) {
              folder.children.push(folderMap.get(childDir)!);
            }
          }
        }
      }
      return [...folderMap.values(), ...fileObjs];
    }),
    createFolder: vi.fn(async (path: string) => new TFolder(path)),
    // 测试辅助：直接塞文件内容
    _setFile: (path: string, content: string) => {
      files[path] = content;
    },
    _files: files,
  };

  const metadataCache = {
    getFirstLinkpathDest: vi.fn((link: string, _sourcePath: string) => {
      // 处理 wiki 链接的锚点/别名
      const base = link.split("#")[0].split("|")[0];
      // 1) 精确路径
      if (files[base] !== undefined) return ensureFile(base);
      if (files[base + ".md"] !== undefined) return ensureFile(base + ".md");
      // 2) 按文件名搜索（Obsidian 行为：按 basename 在库内解析）
      for (const p of Object.keys(files)) {
        if (p.endsWith("/" + base) || p === base) return ensureFile(p);
      }
      return null;
    }),
  };

  const fileManager = {
    renameFile: vi.fn(async (file: TFile, newPath: string) => {
      const content = files[file.path];
      delete files[file.path];
      files[newPath] = content ?? "";
      const newFile = ensureFile(newPath);
      newFile.path = newPath;
      return newFile;
    }),
    generateMarkdownLink: vi.fn((file: TFile, _sourcePath: string) => `[[${file.path}]]`),
    processFrontMatter: vi.fn(async (file: TFile, fn: (fm: Record<string, any>) => void) => {
      const content = files[file.path] ?? "";
      const fm: Record<string, any> = {};
      const body = content.replace(/^---\n([\s\S]*?)\n---\n?/, (_, yaml: string) => {
        for (const line of yaml.split("\n")) {
          const m = line.match(/^(\w+):\s*(.*)$/);
          if (!m) continue;
          const raw = m[2].trim();
          if (raw.startsWith("[") && raw.endsWith("]")) {
            fm[m[1]] = raw
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            fm[m[1]] = raw;
          }
        }
        return "";
      });
      fn(fm);
      const yamlLines = Object.entries(fm)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : v}`)
        .join("\n");
      files[file.path] = `---\n${yamlLines}\n---\n${body}`;
    }),
  };

  const workspace = {
    getActiveFile: vi.fn(() => null),
    getActiveViewOfType: vi.fn(() => null),
  };

  return { vault, metadataCache, fileManager, workspace, files };
}

export type FakeApp = ReturnType<typeof makeFakeApp>;

/** 创建假插件：可注入 settings 覆盖、chatService mock 与 app */
export function makeFakePlugin(overrides: {
  settings?: Partial<AIOrganizerSettings>;
  app?: FakeApp;
  chatImpl?: (messages: any[], options?: any) => Promise<string>;
} = {}) {
  const app = overrides.app ?? makeFakeApp();
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (overrides.settings) {
    Object.assign(settings, overrides.settings);
  }

  const plugin = {
    app: app as any,
    settings,
    providers: [],
    chatService: null as any,
    formatting: null as any,
    imageOrganizer: null as any,
    metadataGenerator: null as any,
    inboxOrganizer: null as any,
    linkSuggester: null as any,
    batchProcessor: null as any,
    translator: null as any,
    textEditor: null as any,
    saveSettings: vi.fn(async () => {}),
    ensureFolder: vi.fn(async (folder: string) => {
      await app.vault.createFolder(folder);
    }),
  } as unknown as AIOrganizerPlugin;

  // buildMessages 委托给真实实现（构造 ChatService 需要 plugin，而 plugin 刚建好）
  const realChat = new ChatService(plugin);
  const chatService = {
    chat: vi.fn(
      overrides.chatImpl ??
        (async (_messages: any[], _options?: any) => "模拟 AI 回复内容")
    ),
    buildMessages: vi.fn((input: string, opts?: any) => realChat.buildMessages(input, opts)),
    getProviders: vi.fn(() => []),
    getAvailableProviders: vi.fn(() => []),
    getConfiguredProfiles: vi.fn(() => []),
    getActiveProvider: vi.fn(() => null),
  };
  plugin.chatService = chatService;

  return plugin;
}

export { TFile, TFolder, Notice };
