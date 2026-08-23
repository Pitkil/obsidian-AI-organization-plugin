import { TFile } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { InboxMoveSuggestion } from "../types";
import { extractJson, truncate, uniquePath } from "../utils";
import { notifyError } from "../utils/notify";
import { tpl } from "../i18n";

// ============================================================
// 智能收件箱整理：一键将收件箱草稿按内容自动分类到对应文件夹
// ============================================================

export class InboxOrganizer {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 列出收件箱中的 Markdown 笔记 */
  listInboxNotes(): TFile[] {
    const folder = this.plugin.settings.inbox.inboxFolder.trim();
    if (!folder) return [];
    const root = this.plugin.app.vault.getAbstractFileByPath(folder);
    if (!root) return [];
    return this.plugin.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder + "/"));
  }

  /** 获取候选文件夹（库内已有的顶级/二级文件夹） */
  private listCandidateFolders(): string[] {
    const folders = new Set<string>();
    for (const f of this.plugin.app.vault.getAllLoadedFiles()) {
      if (!(f instanceof TFile)) continue;
      const parts = f.path.split("/");
      if (parts.length >= 2) folders.add(parts.slice(0, 2).join("/"));
      else if (parts.length === 1 && parts[0].endsWith(".md")) folders.add("/");
    }
    const inbox = this.plugin.settings.inbox.inboxFolder.trim();
    return Array.from(folders)
      .filter((p) => p !== "/" && p !== inbox)
      .sort()
      .slice(0, 200);
  }

  /** 让 AI 为收件箱笔记推荐目标文件夹 */
  async suggestMoves(notes: TFile[]): Promise<InboxMoveSuggestion[]> {
    const folders = this.listCandidateFolders();
    const allowCreate = this.plugin.settings.inbox.allowCreateFolder;

    const fullSummaries: string[] = [];
    for (const n of notes) {
      const content = await this.plugin.app.vault.cachedRead(n);
      fullSummaries.push(`### ${n.name}\n${truncate(content, 500)}`);
    }

    const prompt = `你是知识库整理助手。下面是收件箱中的若干草稿笔记。请为每一篇推荐一个目标文件夹（用于移动）。

可用文件夹（已有）：
${folders.length ? folders.map((f) => `- ${f}`).join("\n") : "（无，可新建）"}

${allowCreate ? "如果没有合适的已有文件夹，可以建议创建一个新的一级文件夹（不要以 / 结尾）。" : "只能从上面已有文件夹中选择，不要新建。"}

请输出 JSON 数组（不要代码围栏、不要解释）：
[
  {"fileName": "笔记文件名.md", "targetFolder": "目标文件夹路径", "reason": "一句话理由"}
]

笔记内容：
${fullSummaries.join("\n\n")}

要求：
- 每条只针对上面列出的笔记，fileName 必须与文件名完全一致。
- targetFolder 不含文件名，用 / 分隔，如 "项目/会议记录"。
- 内容太少无法判断的笔记，targetFolder 设为 ""（保持原位）。`;

    const messages = this.plugin.chatService.buildMessages(prompt, {
      extraSystem: "你只输出一个合法的 JSON 数组，不要输出任何其他文字。",
    });

    const raw = await this.plugin.chatService.chat(messages);
    const parsed = extractJson<InboxMoveSuggestion[]>(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("AI 返回格式无法解析，请重试或换用其他模型");
    }

    // 只保留输入中存在的文件，规范化路径
    const noteNames = new Set(notes.map((n) => n.name));
    return parsed
      .filter((s) => s && noteNames.has(s.fileName))
      .map((s) => ({
        fileName: s.fileName,
        targetFolder: (s.targetFolder || "").replace(/^\/+|\/+$/g, ""),
        reason: s.reason || "",
      }));
  }

  /** 执行移动（用于确认后） */
  async executeMoves(suggestions: InboxMoveSuggestion[]): Promise<{ moved: number; kept: number }> {
    let moved = 0;
    let kept = 0;
    for (const s of suggestions) {
      const file = this.plugin.app.vault.getAbstractFileByPath(s.fileName);
      if (!(file instanceof TFile)) continue;
      if (!s.targetFolder) {
        kept++;
        continue;
      }
      const newPath = uniquePath(`${s.targetFolder}/${file.name}`, (p) =>
        this.plugin.app.vault.getAbstractFileByPath(p) !== null
      );
      try {
        await this.plugin.ensureFolder(s.targetFolder);
        await this.plugin.app.fileManager.renameFile(file, newPath);
        moved++;
      } catch (err: any) {
        notifyError(tpl("notify.moveFail", { name: file.name, msg: err?.message || err }), 6000);
      }
    }
    return { moved, kept };
  }
}
