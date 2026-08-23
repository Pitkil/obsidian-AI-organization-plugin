import { App, Modal, setIcon } from "obsidian";
import { notifyError } from "../utils/notify";
import type { TextEditOp } from "../types";
import { t, tpl } from "../i18n";

// ============================================================
// AI 编辑选中文本模态框（润色 / 扩写 / 续写 / 压缩 + 预览）
// ============================================================

const OPS: { value: TextEditOp; labelKey: string; icon: string; descKey: string }[] = [
  { value: "polish", labelKey: "modal.opPolish", icon: "wand-2", descKey: "modal.opPolishDesc" },
  { value: "expand", labelKey: "modal.opExpand", icon: "expand", descKey: "modal.opExpandDesc" },
  { value: "continue", labelKey: "modal.opContinue", icon: "corner-down-right", descKey: "modal.opContinueDesc" },
  { value: "summarize", labelKey: "modal.opSummarize", icon: "shrink", descKey: "modal.opSummarizeDesc" },
];

export class TextEditModal extends Modal {
  private currentOp: TextEditOp = "polish";
  private result = "";
  private busy = false;
  private previewEl!: HTMLElement;
  private applyBtn!: HTMLButtonElement;
  private regenBtn!: HTMLButtonElement;

  constructor(
    app: App,
    private sourceText: string,
    private transform: (text: string, op: TextEditOp) => Promise<string>,
    private onApply: (result: string) => Promise<void>,
    initialOp: TextEditOp = "polish"
  ) {
    super(app);
    this.currentOp = initialOp;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: t("modal.editTitle"),
    });
    contentEl.createDiv({ cls: "aio-modal-sub", text: tpl("modal.sourceChars", { n: this.sourceText.length }) });

    // 操作选择
    const opWrap = contentEl.createDiv({ cls: "aio-op-selector" });
    for (const op of OPS) {
      const btn = opWrap.createDiv({ cls: `aio-op-btn ${op.value === this.currentOp ? "is-active" : ""}` });
      const labelRow = btn.createDiv({ cls: "aio-op-label-row" });
      const icon = labelRow.createSpan({ cls: "aio-op-icon" });
      setIcon(icon, op.icon);
      labelRow.createSpan({ text: t(op.labelKey) });
      btn.createDiv({ cls: "aio-op-desc", text: t(op.descKey) });
      btn.addEventListener("click", () => {
        this.currentOp = op.value;
        opWrap.querySelectorAll(".aio-op-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        void this.generate();
      });
    }

    // 预览
    this.previewEl = contentEl.createDiv({ cls: "aio-modal-body aio-edit-preview" });
    this.previewEl.createDiv({ cls: "aio-empty-tip", text: t("modal.generating") });

    // 底部
    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());
    this.regenBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("modal.regenerate") });
    this.regenBtn.addEventListener("click", () => void this.generate());
    this.applyBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: t("modal.applyToSelection") });
    this.applyBtn.addEventListener("click", async () => {
      if (!this.result) return;
      this.applyBtn.disabled = true;
      this.applyBtn.setText(t("modal.applying"));
      try {
        await this.onApply(this.result);
        this.close();
      } catch (err: any) {
        notifyError(tpl("notify.applyFail", { msg: err?.message || err }), 6000);
        this.applyBtn.disabled = false;
        this.applyBtn.setText(t("modal.applyToSelection"));
      }
    });

    void this.generate();
  }

  private async generate(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.applyBtn.disabled = true;
    this.regenBtn.disabled = true;
    this.previewEl.empty();
    const loading = this.previewEl.createDiv({ cls: "aio-loading" });
    loading.createSpan({ cls: "aio-spinner" });
    loading.createSpan({ text: t("modal.aiGenerating") });

    try {
      this.result = await this.transform(this.sourceText, this.currentOp);
      this.renderPreview();
    } catch (err: any) {
      this.previewEl.empty();
      this.previewEl.createDiv({ cls: "aio-edit-error", text: `⚠️ ${err?.message || err}` });
    } finally {
      this.busy = false;
      this.applyBtn.disabled = !this.result;
      this.regenBtn.disabled = false;
    }
  }

  private renderPreview(): void {
    this.previewEl.empty();
    const pre = this.previewEl.createEl("pre", { cls: "aio-code" });
    pre.setText(this.result);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
