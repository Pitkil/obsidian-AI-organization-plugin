import { App, Modal, TFile } from "obsidian";
import type { BatchOperation } from "../types";
import { notify } from "../utils/notify";
import { t, tpl } from "../i18n";

// ============================================================
// 批量 AI 处理模态框（选择文件 + 操作类型 + 进度）
// ============================================================

const OPERATIONS: { value: BatchOperation; labelKey: string; descKey: string }[] = [
  { value: "format", labelKey: "modal.opFormat", descKey: "modal.opFormatDesc" },
  { value: "metadata", labelKey: "modal.opMetadata", descKey: "modal.opMetadataDesc" },
  { value: "translate", labelKey: "modal.opTranslate", descKey: "modal.opTranslateDesc" },
];

export class BatchModal extends Modal {
  private files: TFile[] = [];
  private selected = new Set<string>();
  private op: BatchOperation = "format";
  private searchInput!: HTMLInputElement;

  constructor(app: App, private onRun: (files: TFile[], op: BatchOperation) => Promise<void>) {
    super(app);
    this.files = app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
    this.files.forEach((f) => this.selected.add(f.path));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: tpl("modal.batchTitle", { n: this.files.length }),
    });

    // 操作类型
    const opWrap = contentEl.createDiv({ cls: "aio-op-selector" });
    for (const op of OPERATIONS) {
      const btn = opWrap.createDiv({ cls: `aio-op-btn ${op.value === this.op ? "is-active" : ""}` });
      btn.createDiv({ cls: "aio-op-label", text: t(op.labelKey) });
      btn.createDiv({ cls: "aio-op-desc", text: t(op.descKey) });
      btn.addEventListener("click", () => {
        this.op = op.value;
        opWrap.querySelectorAll(".aio-op-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
      });
    }

    // 搜索与全选
    const toolbar = contentEl.createDiv({ cls: "aio-batch-toolbar" });
    this.searchInput = toolbar.createEl("input", {
      cls: "aio-input",
      attr: { placeholder: t("modal.searchNotes") },
    });
    this.searchInput.addEventListener("input", () => this.renderList());
    const selectAll = toolbar.createEl("button", { cls: "aio-btn aio-btn-ghost aio-btn-sm", text: t("modal.selectAll") });
    selectAll.addEventListener("click", () => {
      this.files.forEach((f) => this.selected.add(f.path));
      this.renderList();
    });
    const selectNone = toolbar.createEl("button", { cls: "aio-btn aio-btn-ghost aio-btn-sm", text: t("modal.selectNone") });
    selectNone.addEventListener("click", () => {
      this.selected.clear();
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: "aio-list aio-batch-list" });
    this.renderList();

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());
    const runBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: t("modal.start") });
    runBtn.addEventListener("click", async () => {
      const chosen = this.files.filter((f) => this.selected.has(f.path));
      if (chosen.length === 0) {
        notify(t("notify.selectAtLeastOne"));
        return;
      }
      this.close();
      await this.onRun(chosen, this.op);
    });
  }

  private listEl!: HTMLElement;

  private renderList(): void {
    this.listEl.empty();
    const query = this.searchInput?.value.trim().toLowerCase() || "";
    const filtered = this.files.filter((f) => !query || f.basename.toLowerCase().includes(query));
    const countEl = this.listEl.createDiv({ cls: "aio-batch-count" });
    countEl.setText(tpl("modal.selectedCount", { a: this.selected.size, b: this.files.length }));

    for (const f of filtered) {
      const row = this.listEl.createDiv({ cls: "aio-list-row aio-list-row-selectable" });
      const checkbox = row.createEl("input", { type: "checkbox", cls: "aio-checkbox" });
      checkbox.checked = this.selected.has(f.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(f.path);
        else this.selected.delete(f.path);
        this.renderList();
      });
      const main = row.createDiv({ cls: "aio-list-main" });
      main.createDiv({ cls: "aio-list-title", text: f.basename });
      main.createDiv({ cls: "aio-list-sub", text: f.path });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
