import { App, Modal, Notice } from "obsidian";
import type { CustomPromptTemplate } from "../types";

// ============================================================
// 自定义排版模板编辑模态框
// ============================================================

export class TemplateEditModal extends Modal {
  private nameInput!: HTMLInputElement;
  private promptInput!: HTMLTextAreaElement;

  constructor(
    app: App,
    private initial: CustomPromptTemplate | null,
    private onSave: (template: CustomPromptTemplate) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: this.initial ? `编辑模板「${this.initial.name}」` : "新建自定义排版模板",
    });

    const form = contentEl.createDiv({ cls: "aio-template-form" });
    form.createDiv({ cls: "aio-form-label", text: "模板名称" });
    this.nameInput = form.createEl("input", {
      cls: "aio-input",
      attr: { placeholder: "如：论文排版 / 日记排版 / 英文排版" },
    });
    this.nameInput.value = this.initial?.name || "";

    form.createDiv({ cls: "aio-form-label", text: "排版提示词" });
    this.promptInput = form.createEl("textarea", {
      cls: "aio-input aio-textarea",
      attr: { placeholder: "描述你希望 AI 如何排版。提示词末尾会自动追加：请直接输出排版后的完整 Markdown 全文…" },
    });
    this.promptInput.value = this.initial?.prompt || "";
    this.promptInput.rows = 8;
    this.promptInput.addClass("aio-template-prompt");

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "保存" });
    saveBtn.addEventListener("click", () => {
      const name = this.nameInput.value.trim();
      const prompt = this.promptInput.value.trim();
      if (!name) {
        new Notice("请填写模板名称");
        return;
      }
      if (!prompt) {
        new Notice("请填写提示词");
        return;
      }
      this.onSave({ name, prompt });
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
