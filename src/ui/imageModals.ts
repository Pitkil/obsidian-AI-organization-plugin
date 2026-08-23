import { App, Modal, Setting, TFile, setIcon } from "obsidian";
import type { OrganizedImage } from "../types";
import { t, tpl } from "../i18n";

// ============================================================
// 图片整理结果 / 孤儿附件管理 模态框
// ============================================================

export class ImageResultModal extends Modal {
  constructor(
    app: App,
    private result: {
      movedCount: number;
      orphanCount: number;
      targetFolder: string;
      items: OrganizedImage[];
    }
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    const moved = this.result.items.filter((i) => i.moved);
    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: t("modal.imageDoneTitle"),
    });

    const stats = contentEl.createDiv({ cls: "aio-modal-stats" });
    stats.createSpan({ cls: "aio-stat aio-stat-add", text: tpl("modal.movedCount", { n: moved.length }) });
    stats.createSpan({ cls: "aio-stat-neutral", text: tpl("modal.targetFolderStat", { folder: this.result.targetFolder || t("modal.vaultRoot") }) });
    if (this.result.orphanCount > 0) {
      stats.createSpan({ cls: "aio-stat-warn", text: tpl("modal.orphanFound", { n: this.result.orphanCount }) });
    } else {
      stats.createSpan({ cls: "aio-stat-neutral", text: t("modal.noOrphans") });
    }

    if (moved.length > 0) {
      const list = contentEl.createDiv({ cls: "aio-list" });
      for (const item of moved.slice(0, 50)) {
        const row = list.createDiv({ cls: "aio-list-row" });
        const icon = row.createSpan({ cls: "aio-list-icon" });
        setIcon(icon, "image");
        const main = row.createDiv({ cls: "aio-list-main" });
        main.createDiv({ cls: "aio-list-title", text: `${item.name}.${item.ext}` });
        main.createDiv({ cls: "aio-list-sub", text: `${item.oldPath}  →  ${item.newPath}` });
      }
      if (moved.length > 50) {
        contentEl.createDiv({ cls: "aio-modal-sub", text: tpl("modal.andMoreImages", { n: moved.length }) });
      }
    } else {
      contentEl.createDiv({ cls: "aio-modal-sub", text: t("modal.nothingToMove") });
    }

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const okBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: t("modal.done") });
    okBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ImageOrganizeModal extends Modal {
  private targetFolder: string;
  private renameImages: boolean;

  constructor(
    app: App,
    defaultTargetFolder: string,
    defaultRenameImages: boolean,
    private onSubmit: (opts: { targetFolder: string; renameImages: boolean }) => Promise<void>
  ) {
    super(app);
    this.targetFolder = defaultTargetFolder;
    this.renameImages = defaultRenameImages;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: t("modal.organizeImages"),
    });
    contentEl.createDiv({
      cls: "aio-modal-sub",
      text: t("modal.organizeImagesSub"),
    });

    new Setting(contentEl)
      .setName(t("modal.targetFolderName"))
      .setDesc(t("modal.targetFolderDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("modal.targetFolderPlaceholder"))
          .setValue(this.targetFolder)
          .onChange((value) => {
            this.targetFolder = value.trim().replace(/^\/+|\/+$/g, "");
          })
      );

    new Setting(contentEl)
      .setName(t("st.autoRename"))
      .setDesc(t("modal.autoRenameDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.renameImages).onChange((value) => {
          this.renameImages = value;
        })
      );

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: t("modal.startOrganize") });
    submitBtn.addEventListener("click", async () => {
      submitBtn.disabled = true;
      submitBtn.setText(t("modal.organizing"));
      try {
        await this.onSubmit({
          targetFolder: this.targetFolder,
          renameImages: this.renameImages,
        });
        this.close();
      } catch {
        submitBtn.disabled = false;
        submitBtn.setText(t("common.retry"));
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class OrphanModal extends Modal {
  constructor(
    app: App,
    private orphans: TFile[],
    private onMove: (files: TFile[]) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("aio-modal");

    contentEl.createDiv({ cls: "aio-modal-header" }).createDiv({
      cls: "aio-modal-title",
      text: tpl("modal.orphanTitle", { n: this.orphans.length }),
    });
    contentEl.createDiv({
      cls: "aio-modal-sub",
      text: t("modal.orphanSub"),
    });

    const list = contentEl.createDiv({ cls: "aio-list aio-batch-list" });
    for (const f of this.orphans.slice(0, 100)) {
      const row = list.createDiv({ cls: "aio-list-row" });
      const icon = row.createSpan({ cls: "aio-list-icon" });
      setIcon(icon, "file-image");
      const main = row.createDiv({ cls: "aio-list-main" });
      main.createDiv({ cls: "aio-list-title", text: f.name });
      main.createDiv({ cls: "aio-list-sub", text: f.path });
    }
    if (this.orphans.length > 100) {
      contentEl.createDiv({ cls: "aio-modal-sub", text: tpl("modal.orphanAndMore", { n: this.orphans.length }) });
    }

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: t("common.close") });
    cancelBtn.addEventListener("click", () => this.close());
    const moveBtn = footer.createEl("button", {
      cls: "aio-btn aio-btn-warn",
      text: tpl("modal.moveToOrphans", { n: this.orphans.length }),
    });
    moveBtn.addEventListener("click", async () => {
      moveBtn.disabled = true;
      moveBtn.setText(t("modal.moving"));
      try {
        await this.onMove(this.orphans);
        this.close();
      } catch (err: any) {
        moveBtn.disabled = false;
        moveBtn.setText(t("common.retry"));
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
