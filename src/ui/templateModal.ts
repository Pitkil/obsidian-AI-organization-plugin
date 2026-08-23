import { App, Modal } from "obsidian";
import { notify } from "../utils/notify";
import type { CustomPromptTemplate } from "../types";
import { t, tpl } from "../i18n";

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
      text: this.initial ? tpl("modal.templateEdit", { name: this.initial.name }) : t("modal.templateNew"),
    });

    const form = contentEl.createDiv({ cls: "aio-template-form" });
    form.createDiv({ cls: "aio-form-label", text: t("modal.templateName") });
    this.nameInput = form.createEl("input", {
      cls: "aio-input",
      attr: { placeholder: t("modal.templateNamePlaceholder") },
    });
    this.nameInput.value = this.initial?.name || "";

    form.createDiv({ cls: "aio-form-label", text: t("modal.templatePrompt") });
    this.promptInput = form.createEl("textarea", {
      cls: "aio-input aio-textarea",
      attr: { placeholder: t("modal.templatePromptPlaceholder") },
    });
    this.promptInput.value = this.initial?.prompt || "";
    this.promptInput.rows = 8;
    this.promptInput.addClass("aio-template-prompt");

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: t("common.save") });
    saveBtn.addEventListener("click", () => {
      const name = this.nameInput.value.trim();
      const prompt = this.promptInput.value.trim();
      if (!name) {
        notify(t("notify.templateNameRequired"));
        return;
      }
      if (!prompt) {
        notify(t("notify.promptRequired"));
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
