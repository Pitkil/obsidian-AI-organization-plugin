import { App, Modal, TFile } from "obsidian";
import { countChanges, diffLines, type DiffOp } from "../core/diff";
import { formatNumber } from "../utils";
import { notifyError } from "../utils/notify";
import { t, tpl } from "../i18n";

// ============================================================
// AI 排版预览模态框（原文 / 排版后 / 差异 三视图）
// ============================================================

export class FormattingPreviewModal extends Modal {
  private currentView: "before" | "after" | "diff" = "after";

  constructor(
    app: App,
    private file: TFile,
    private before: string,
    private after: string,
    private onApply: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");
    const invalidReason = this.invalidResultReason();

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: tpl("modal.previewTitle", { name: this.file.basename }),
    });

    // 统计
    const ops = diffLines(this.before, this.after);
    const { add, remove } = countChanges(ops);
    const stats = contentEl.createDiv({ cls: "aio-modal-stats" });
    stats.createSpan({ cls: "aio-stat aio-stat-remove", text: tpl("modal.removeLines", { n: formatNumber(remove) }) });
    stats.createSpan({ cls: "aio-stat aio-stat-add", text: tpl("modal.addLines", { n: formatNumber(add) }) });
    stats.createSpan({ cls: "aio-stat-neutral", text: tpl("modal.charsChange", { a: this.before.length, b: this.after.length }) });
    if (invalidReason) {
      contentEl.createDiv({ cls: "aio-format-warning", text: invalidReason });
    }

    // 视图切换
    const tabs = contentEl.createDiv({ cls: "aio-tabs" });
    const makeTab = (id: "before" | "after" | "diff", label: string) => {
      const tab = tabs.createDiv({ cls: `aio-tab ${this.currentView === id ? "is-active" : ""}` });
      tab.setText(label);
      tab.addEventListener("click", () => {
        this.currentView = id;
        tabs.querySelectorAll(".aio-tab").forEach((t) => t.removeClass("is-active"));
        tab.addClass("is-active");
        this.renderBody();
      });
      return tab;
    };
    makeTab("before", t("modal.tabBefore"));
    makeTab("after", t("modal.tabAfter"));
    makeTab("diff", t("modal.tabDiff"));

    this.bodyEl = contentEl.createDiv({ cls: "aio-modal-body" });
    this.renderBody();

    // 底部操作
    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());
    const applyBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: t("modal.apply") });
    if (invalidReason) {
      applyBtn.disabled = true;
      applyBtn.setText(t("modal.invalidResult"));
    }
    applyBtn.addEventListener("click", async () => {
      if (invalidReason) return;
      applyBtn.setText(t("modal.applying"));
      applyBtn.disabled = true;
      try {
        await this.onApply();
        this.close();
      } catch (err: any) {
        notifyError(tpl("notify.applyFail", { msg: err?.message || err }), 6000);
        applyBtn.setText(t("modal.apply"));
        applyBtn.disabled = false;
      }
    });
  }

  private bodyEl!: HTMLElement;

  private renderBody(): void {
    this.bodyEl.empty();
    const invalidReason = this.invalidResultReason();
    if (invalidReason && this.currentView === "after") {
      this.bodyEl.createDiv({ cls: "aio-format-empty", text: invalidReason });
      return;
    }
    if (this.currentView === "diff") {
      this.renderDiff(diffLines(this.before, this.after));
    } else {
      const pre = this.bodyEl.createEl("pre", { cls: "aio-code" });
      pre.setText(this.currentView === "before" ? this.before : this.after);
    }
  }

  private invalidResultReason(): string {
    const beforeText = this.before.trim();
    const afterText = this.after.trim();
    if (!afterText) return t("modal.emptyResult");
    if (beforeText.length >= 200 && afterText.length < Math.max(80, beforeText.length * 0.25)) {
      return tpl("modal.tooShortResult", { a: beforeText.length, b: afterText.length });
    }
    return "";
  }

  private renderDiff(ops: DiffOp[]): void {
    const pre = this.bodyEl.createEl("pre", { cls: "aio-code aio-diff" });
    for (const op of ops) {
      const line = pre.createEl("div", { cls: `aio-diff-line aio-diff-${op.type}` });
      const marker = line.createSpan({ cls: "aio-diff-marker" });
      marker.setText(op.type === "add" ? "+" : op.type === "remove" ? "−" : " ");
      line.createSpan({ text: op.text || " " });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
