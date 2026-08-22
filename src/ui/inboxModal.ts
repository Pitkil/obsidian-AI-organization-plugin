import { App, Modal, Notice, setIcon } from "obsidian";
import type { InboxMoveSuggestion } from "../types";
import { sanitizeFileName } from "../utils";

// ============================================================
// 智能收件箱整理确认模态框（可编辑目标文件夹）
// ============================================================

export class InboxConfirmModal extends Modal {
  private folders: Map<string, HTMLInputElement> = new Map();

  constructor(
    app: App,
    private suggestions: InboxMoveSuggestion[],
    private onConfirm: (moves: InboxMoveSuggestion[]) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: `整理收件箱 — ${this.suggestions.length} 篇笔记`,
    });
    contentEl.createDiv({
      cls: "aio-modal-sub",
      text: "AI 已为每篇笔记推荐目标文件夹，可修改后再确认移动",
    });

    const list = contentEl.createDiv({ cls: "aio-list" });
    for (const s of this.suggestions) {
      const row = list.createDiv({ cls: "aio-list-row" });
      const info = row.createDiv({ cls: "aio-list-main" });
      info.createDiv({ cls: "aio-list-title", text: s.fileName });
      if (s.reason) info.createDiv({ cls: "aio-list-sub", text: s.reason });
      const folderWrap = row.createDiv({ cls: "aio-list-edit" });
      const input = folderWrap.createEl("input", {
        cls: "aio-input",
        attr: { placeholder: "目标文件夹（留空 = 保持原位）" },
      });
      input.value = s.targetFolder || "";
      this.folders.set(s.fileName, input);
    }

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "确认移动" });
    confirmBtn.addEventListener("click", async () => {
      const moves = this.suggestions.map((s) => ({
        fileName: s.fileName,
        targetFolder: sanitizeFileName((this.folders.get(s.fileName)?.value || "").trim()).replace(
          /^\/+|\/+$/g,
          ""
        ),
        reason: s.reason,
      }));
      confirmBtn.disabled = true;
      confirmBtn.setText("移动中…");
      try {
        await this.onConfirm(moves);
        this.close();
      } catch (err: any) {
        new Notice(`整理失败：${err?.message || err}`, 6000);
        confirmBtn.disabled = false;
        confirmBtn.setText("确认移动");
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
