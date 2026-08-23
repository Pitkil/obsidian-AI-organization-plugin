import { App, Modal, setIcon } from "obsidian";
import { notifyError } from "../utils/notify";
import type { InboxMoveSuggestion } from "../types";
import { sanitizeFileName } from "../utils";
import { t, tpl } from "../i18n";

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
      text: tpl("modal.inboxTitle", { n: this.suggestions.length }),
    });
    contentEl.createDiv({
      cls: "aio-modal-sub",
      text: t("modal.inboxSub"),
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
        attr: { placeholder: t("modal.folderPlaceholder") },
      });
      input.value = s.targetFolder || "";
      this.folders.set(s.fileName, input);
    }

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: t("modal.confirmMove") });
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
      confirmBtn.setText(t("modal.moving"));
      try {
        await this.onConfirm(moves);
        this.close();
      } catch (err: any) {
        notifyError(tpl("notify.inboxFail", { msg: err?.message || err }), 6000);
        confirmBtn.disabled = false;
        confirmBtn.setText(t("modal.confirmMove"));
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
