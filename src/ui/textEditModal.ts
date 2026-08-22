import { App, Modal, Notice, setIcon } from "obsidian";
import type { TextEditOp } from "../types";

// ============================================================
// AI 编辑选中文本模态框（润色 / 扩写 / 续写 / 压缩 + 预览）
// ============================================================

const OPS: { value: TextEditOp; label: string; icon: string; desc: string }[] = [
  { value: "polish", label: "润色", icon: "wand-2", desc: "优化表达与流畅度" },
  { value: "expand", label: "扩写", icon: "expand", desc: "补充细节更丰富" },
  { value: "continue", label: "续写", icon: "corner-down-right", desc: "自然衔接续写" },
  { value: "summarize", label: "压缩", icon: "shrink", desc: "提炼要点精简" },
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
      text: "AI 编辑选中文本",
    });
    contentEl.createDiv({ cls: "aio-modal-sub", text: `原文 ${this.sourceText.length} 字` });

    // 操作选择
    const opWrap = contentEl.createDiv({ cls: "aio-op-selector" });
    for (const op of OPS) {
      const btn = opWrap.createDiv({ cls: `aio-op-btn ${op.value === this.currentOp ? "is-active" : ""}` });
      const labelRow = btn.createDiv({ cls: "aio-op-label-row" });
      const icon = labelRow.createSpan({ cls: "aio-op-icon" });
      setIcon(icon, op.icon);
      labelRow.createSpan({ text: op.label });
      btn.createDiv({ cls: "aio-op-desc", text: op.desc });
      btn.addEventListener("click", () => {
        this.currentOp = op.value;
        opWrap.querySelectorAll(".aio-op-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
        void this.generate();
      });
    }

    // 预览
    this.previewEl = contentEl.createDiv({ cls: "aio-modal-body aio-edit-preview" });
    this.previewEl.createDiv({ cls: "aio-empty-tip", text: "正在生成…" });

    // 底部
    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());
    this.regenBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "重新生成" });
    this.regenBtn.addEventListener("click", () => void this.generate());
    this.applyBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "应用到选中文本" });
    this.applyBtn.addEventListener("click", async () => {
      if (!this.result) return;
      this.applyBtn.disabled = true;
      this.applyBtn.setText("应用中…");
      try {
        await this.onApply(this.result);
        this.close();
      } catch (err: any) {
        new Notice(`应用失败：${err?.message || err}`, 6000);
        this.applyBtn.disabled = false;
        this.applyBtn.setText("应用到选中文本");
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
    loading.createSpan({ text: "AI 正在生成…" });

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
