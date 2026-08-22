import { App, Modal, Notice, TFile } from "obsidian";
import type { BatchOperation } from "../types";

// ============================================================
// 批量 AI 处理模态框（选择文件 + 操作类型 + 进度）
// ============================================================

const OPERATIONS: { value: BatchOperation; label: string; desc: string }[] = [
  { value: "format", label: "AI 排版", desc: "按排版设置对每篇笔记排版" },
  { value: "metadata", label: "生成标签/摘要", desc: "为每篇笔记生成 frontmatter 元数据" },
  { value: "translate", label: "翻译", desc: "翻译为设置的目标语言" },
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
      text: `批量 AI 处理（${this.files.length} 篇笔记）`,
    });

    // 操作类型
    const opWrap = contentEl.createDiv({ cls: "aio-op-selector" });
    for (const op of OPERATIONS) {
      const btn = opWrap.createDiv({ cls: `aio-op-btn ${op.value === this.op ? "is-active" : ""}` });
      btn.createDiv({ cls: "aio-op-label", text: op.label });
      btn.createDiv({ cls: "aio-op-desc", text: op.desc });
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
      attr: { placeholder: "搜索笔记名…" },
    });
    this.searchInput.addEventListener("input", () => this.renderList());
    const selectAll = toolbar.createEl("button", { cls: "aio-btn aio-btn-ghost aio-btn-sm", text: "全选" });
    selectAll.addEventListener("click", () => {
      this.files.forEach((f) => this.selected.add(f.path));
      this.renderList();
    });
    const selectNone = toolbar.createEl("button", { cls: "aio-btn aio-btn-ghost aio-btn-sm", text: "全不选" });
    selectNone.addEventListener("click", () => {
      this.selected.clear();
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: "aio-list aio-batch-list" });
    this.renderList();

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());
    const runBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "开始处理" });
    runBtn.addEventListener("click", async () => {
      const chosen = this.files.filter((f) => this.selected.has(f.path));
      if (chosen.length === 0) {
        new Notice("请至少选择一篇笔记");
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
    countEl.setText(`已选 ${this.selected.size} / ${this.files.length}`);

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
