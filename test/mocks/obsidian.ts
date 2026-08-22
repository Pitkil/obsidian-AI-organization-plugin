// ============================================================
// obsidian 模块的 mock 实现（供各测试文件的 vi.mock 工厂引用）
// 测试代码统一从 "obsidian" 导入这些类（被拦截为 mock），
// 与核心服务中的 instanceof 判断保持同一类身份。
// ============================================================
import { vi } from "vitest";

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent: TFolder | null;
  stat = { ctime: 0, mtime: 0, size: 0 };

  constructor(path: string, parent: TFolder | null = null) {
    this.path = path;
    this.parent = parent;
    const parts = path.split("/");
    this.name = parts[parts.length - 1] ?? path;
    const dot = this.name.lastIndexOf(".");
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
  }
}

export class TFolder {
  path: string;
  name: string;
  parent: TFolder | null;
  children: (TFile | TFolder)[] = [];

  constructor(path: string, parent: TFolder | null = null) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.parent = parent;
  }
}

export class Notice {
  constructor(public message: string, public timeout?: number) {}
}

export class Plugin {
  app: any;
  manifest: any = {};
  loadData = vi.fn(async () => ({}));
  saveData = vi.fn(async () => {});
  registerEvent = vi.fn();
  registerEditorExtension = vi.fn();
  addCommand = vi.fn();
  addRibbonIcon = vi.fn(() => ({ addClass: vi.fn(), setAttribute: vi.fn() }));
  addSettingTab = vi.fn();
  registerDomEvent = vi.fn();
  registerInterval = vi.fn();
}

export class MarkdownView {}
export class Editor {}
export class EditorPosition {}
export class Menu {}
export class Modal {
  app: any;
  constructor(app: any) {
    this.app = app;
  }
  open() {}
  close() {}
}
export class Component {
  addChild = vi.fn();
  register = vi.fn();
  onunload = vi.fn();
}

export const setIcon = vi.fn();
export const Platform = { isMobile: false };
export const requestUrl = vi.fn();
export const moment = vi.fn(() => ({ format: () => "2026-01-01" }));

export const Vault = class {};
export const Workspace = class {};
export const MetadataCache = class {};
export const FileManager = class {};
export const Keymap = { isModEvent: vi.fn(() => false) };
export const getAllTags = vi.fn(() => []);

export const obsidian = {
  normalizePath: (path: string) => path.replace(/\\/g, "/"),
  TFile,
  TFolder,
  Notice,
  Plugin,
  MarkdownView,
  Editor,
  EditorPosition,
  Menu,
  Modal,
  Component,
  setIcon,
  Platform,
  requestUrl,
  moment,
  Vault,
  Workspace,
  MetadataCache,
  FileManager,
  Keymap,
  getAllTags,
  default: {},
};

export default obsidian;
