import { App, Modal } from "obsidian";
import { notify, notifyError } from "../utils/notify";
import type { LinkSuggestion } from "../types";

// ============================================================
// AI 双链建议模态框
// ============================================================

export class LinkSuggestModal extends Modal {
  private selected = new Set<string>();

  constructor(
    app: App,
    private suggestions: LinkSuggestion[],
    private onAppend: (selected: LinkSuggestion[]) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: `AI 推荐了 ${this.suggestions.length} 个相关笔记`,
    });

    if (this.suggestions.length === 0) {
      contentEl.createDiv({ cls: "aio-modal-sub", text: "未找到足够相关的笔记，换个主题再试试。" });
      const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
      const okBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "知道了" });
      okBtn.addEventListener("click", () => this.close());
      return;
    }

    const list = contentEl.createDiv({ cls: "aio-list" });
    for (const s of this.suggestions) {
      this.selected.add(s.path);
      const row = list.createDiv({ cls: "aio-list-row aio-list-row-selectable" });
      const checkbox = row.createEl("input", { type: "checkbox", cls: "aio-checkbox" });
      checkbox.checked = true;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(s.path);
        else this.selected.delete(s.path);
      });
      const main = row.createDiv({ cls: "aio-list-main" });
      main.createDiv({ cls: "aio-list-title" }).createSpan({ cls: "aio-link-chip", text: `[[${s.basename}]]` });
      if (s.reason) main.createDiv({ cls: "aio-list-sub", text: s.reason });
    }

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());
    const appendBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "添加到笔记末尾" });
    appendBtn.addEventListener("click", async () => {
      const selected = this.suggestions.filter((s) => this.selected.has(s.path));
      if (selected.length === 0) {
        notify("未选择链接");
        return;
      }
      appendBtn.disabled = true;
      appendBtn.setText("添加中…");
      try {
        await this.onAppend(selected);
        this.close();
      } catch (err: any) {
        notifyError(`添加失败：${err?.message || err}`, 6000);
        appendBtn.disabled = false;
        appendBtn.setText("添加到笔记末尾");
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
