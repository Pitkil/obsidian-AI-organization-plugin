import { TFile, TFolder } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { OrganizeResult, OrganizedImage } from "../types";
import { sanitizeFileName, uniquePath } from "../utils";
import { notifyError } from "../utils/notify";

// ============================================================
// 一键图片整理服务
// 1. 扫描当前笔记引用的图片 → 移动到指定附件目录（可按笔记分子文件夹）
// 2. 可选自动重命名（笔记名-N.ext），移动后自动更新笔记内链接
// 3. 可选扫描并整理未引用（孤儿）附件
// ============================================================

export const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "avif",
  "ico",
  "heic",
]);

export class ImageOrganizer {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 从笔记内容中提取所有图片引用，返回对应文件 */
  extractImageRefs(content: string, notePath: string): TFile[] {
    const refs = new Map<string, TFile>();
    const add = (linkText: string) => {
      const link = linkText.trim().split("|")[0].trim();
      if (!link) return;
      const lower = link.toLowerCase();
      const ext = lower.includes(".") ? lower.split(".").pop()! : "";
      if (!IMAGE_EXTS.has(ext)) return;
      // 尝试解析为 vault 内文件
      const file = this.plugin.app.metadataCache.getFirstLinkpathDest(link, notePath);
      if (file instanceof TFile) {
        refs.set(file.path, file);
      }
    };

    // 1) Wiki 嵌入 ![[name.png]] / ![[name.png|300]]
    const wikiRegex = /!\[\[([^\]|]+(?:\|[^\]]*)?)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = wikiRegex.exec(content)) !== null) {
      add(m[1]);
    }

    // 2) Markdown 图片 ![alt](path) / ![](path)
    const mdRegex = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    while ((m = mdRegex.exec(content)) !== null) {
      const raw = m[1];
      // 跳过 http(s) 与 data URI（外部图片不处理）
      if (/^(https?:|data:|file:)/i.test(raw)) continue;
      add(raw);
    }

    return Array.from(refs.values());
  }

  /** 计算目标文件夹路径 */
  targetFolderFor(note: TFile, folderOverride?: string): string {
    if (folderOverride?.trim()) {
      return folderOverride.trim().replace(/^\/+|\/+$/g, "");
    }
    const s = this.plugin.settings.imageOrg;
    const root = (s.attachmentRoot || "attachments").trim().replace(/^\/+|\/+$/g, "");
    if (s.subfolderPerNote) {
      return `${root}/${sanitizeFileName(note.basename)}`;
    }
    return root;
  }

  /** 整理当前笔记的图片 */
  async organizeNote(
    note: TFile,
    opts: { targetFolder?: string; renameImages?: boolean } = {}
  ): Promise<OrganizeResult> {
    const s = this.plugin.settings.imageOrg;
    const content = await this.plugin.app.vault.read(note);
    const files = this.extractImageRefs(content, note.path);
    const targetFolder = this.targetFolderFor(note, opts.targetFolder);
    const renameImages = opts.renameImages ?? s.renameImages;

    const items: OrganizedImage[] = [];
    let movedCount = 0;

    for (const file of files) {
      const ext = file.extension;
      const isAlreadyInTarget = file.parent?.path === targetFolder;
      if (isAlreadyInTarget) {
        items.push({
          name: file.basename,
          ext,
          oldPath: file.path,
          newPath: file.path,
          moved: false,
        });
        continue;
      }

      // 新文件名
      let newName = file.basename;
      if (renameImages) {
        const used = new Set(
          this.plugin.app.vault
            .getFiles()
            .filter((f) => f.parent?.path === targetFolder)
            .map((f) => f.basename)
        );
        let counter = 1;
        let candidate = `${sanitizeFileName(note.basename)}-${counter}`;
        while (used.has(candidate)) {
          counter++;
          candidate = `${sanitizeFileName(note.basename)}-${counter}`;
        }
        newName = candidate;
      }

      const newPath = uniquePath(`${targetFolder}/${newName}.${ext}`, (p) =>
        this.plugin.app.vault.getAbstractFileByPath(p) !== null
      );

      try {
        await this.ensureFolder(targetFolder);
        await this.plugin.app.fileManager.renameFile(file, newPath);
        items.push({ name: newName, ext, oldPath: file.path, newPath, moved: true });
        movedCount++;
      } catch (err: any) {
        notifyError(`移动失败：${file.name} → ${err?.message || err}`, 6000);
      }
    }

    if (items.some((item) => item.moved)) {
      await this.rewriteCurrentNoteLinks(note, items);
    }

    // 孤儿扫描
    let orphanCount = 0;
    if (s.checkOrphans) {
      orphanCount = (await this.findOrphans(targetFolder, note)).length;
    }

    return { movedCount, orphanCount, targetFolder, items };
  }

  private async rewriteCurrentNoteLinks(note: TFile, items: OrganizedImage[]): Promise<void> {
    let content = await this.plugin.app.vault.read(note);
    let changed = false;

    for (const item of items) {
      if (!item.moved) continue;
      const newFile = this.plugin.app.vault.getAbstractFileByPath(item.newPath);
      if (!(newFile instanceof TFile)) continue;

      const generated = this.plugin.app.fileManager.generateMarkdownLink(newFile, note.path);
      const wikiTarget = generated.replace(/^\[\[/, "").replace(/\]\]$/, "");
      const oldName = item.oldPath.split("/").pop() ?? item.oldPath;
      const oldBase = oldName.replace(new RegExp(`\\.${escapeRegExp(item.ext)}$`, "i"), "");

      content = content.replace(/!\[\[([^\]]+)\]\]/g, (match, raw: string) => {
        const [target, ...rest] = raw.split("|");
        if (!sameImageTarget(target, item.oldPath, oldName, oldBase)) return match;
        changed = true;
        return `![[${wikiTarget}${rest.length ? "|" + rest.join("|") : ""}]]`;
      });

      content = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt: string, raw: string) => {
        const target = raw.trim().replace(/^<|>$/g, "");
        if (/^(https?:|data:|file:)/i.test(target)) return match;
        if (!sameImageTarget(decodeURI(target), item.oldPath, oldName, oldBase)) return match;
        changed = true;
        return `![${alt}](${encodeURI(item.newPath)})`;
      });
    }

    if (changed) {
      await this.plugin.app.vault.modify(note, content);
    }
  }

  /**
   * 在目标附件目录中找出未被任何笔记引用的图片（孤儿文件）。
   * 返回孤儿文件列表（不删除，仅报告，便于用户决定）。
   */
  async findOrphans(targetFolder?: string, excludeNote?: TFile): Promise<TFile[]> {
    // 收集所有笔记中引用的图片路径
    const referenced = new Set<string>();
    const notes = this.plugin.app.vault.getMarkdownFiles();
    for (const note of notes) {
      const content = await this.plugin.app.vault.cachedRead(note);
      for (const f of this.extractImageRefs(content, note.path)) {
        referenced.add(f.path);
      }
    }

    const folders = this.plugin.app.vault.getAllLoadedFiles().filter(
      (f): f is TFolder => f instanceof TFolder
    );

    // 附件目录 = 设置的根目录（或包含图片的目录）
    const roots: string[] = [];
    const root = (this.plugin.settings.imageOrg.attachmentRoot || "attachments")
      .trim()
      .replace(/^\/+|\/+$/g, "");
    if (root) roots.push(root);
    // 若指定了 targetFolder 则加入
    if (targetFolder) roots.push(targetFolder);

    const orphans: TFile[] = [];
    for (const folder of folders) {
      if (roots.length > 0 && !roots.some((r) => folder.path === r || folder.path.startsWith(r + "/"))) {
        continue;
      }
      for (const child of folder.children) {
        if (!(child instanceof TFile)) continue;
        if (!IMAGE_EXTS.has(child.extension)) continue;
        if (referenced.has(child.path)) continue;
        if (excludeNote && child.path === excludeNote.path) continue;
        orphans.push(child);
      }
    }
    return orphans;
  }

  /** 将孤儿附件移动到「未引用附件」目录（不删除，安全） */
  async moveOrphansToTrash(files: TFile[]): Promise<number> {
    if (files.length === 0) return 0;
    const trashFolder = "未引用附件";
    await this.ensureFolder(trashFolder);
    let count = 0;
    for (const file of files) {
      const newPath = uniquePath(`${trashFolder}/${file.name}`, (p) =>
        this.plugin.app.vault.getAbstractFileByPath(p) !== null
      );
      try {
        await this.plugin.app.fileManager.renameFile(file, newPath);
        count++;
      } catch {
        /* 忽略单个失败 */
      }
    }
    return count;
  }

  /** 确保目录存在 */
  async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    if (this.plugin.app.vault.getAbstractFileByPath(path)) return;
    await this.plugin.app.vault.createFolder(path);
  }
}

function sameImageTarget(target: string, oldPath: string, oldName: string, oldBase: string): boolean {
  const clean = target.trim().replace(/^\/+/, "");
  return clean === oldPath || clean === oldName || clean === oldBase;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
