import { App, Modal, Setting, TFile, setIcon } from "obsidian";
import type { OrganizedImage } from "../types";

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
      text: `图片整理完成`,
    });

    const stats = contentEl.createDiv({ cls: "aio-modal-stats" });
    stats.createSpan({ cls: "aio-stat aio-stat-add", text: `移动 ${moved.length} 张` });
    stats.createSpan({ cls: "aio-stat-neutral", text: `目标：${this.result.targetFolder || "库根目录"}` });
    if (this.result.orphanCount > 0) {
      stats.createSpan({ cls: "aio-stat-warn", text: `发现 ${this.result.orphanCount} 个未引用附件` });
    } else {
      stats.createSpan({ cls: "aio-stat-neutral", text: "无未引用附件" });
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
        contentEl.createDiv({ cls: "aio-modal-sub", text: `…等共 ${moved.length} 张` });
      }
    } else {
      contentEl.createDiv({ cls: "aio-modal-sub", text: "没有需要移动的图片（可能已在目标目录）。" });
    }

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const okBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "完成" });
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
      text: "整理图片",
    });
    contentEl.createDiv({
      cls: "aio-modal-sub",
      text: "选择本次图片要移动到的文件夹。移动后会同步更新当前笔记中的图片链接。",
    });

    new Setting(contentEl)
      .setName("目标文件夹")
      .setDesc("相对库根目录，例如：附件/项目A、素材/截图。留空表示库根目录。")
      .addText((text) =>
        text
          .setPlaceholder("附件/当前项目")
          .setValue(this.targetFolder)
          .onChange((value) => {
            this.targetFolder = value.trim().replace(/^\/+|\/+$/g, "");
          })
      );

    new Setting(contentEl)
      .setName("自动重命名")
      .setDesc("按当前笔记名生成图片名，避免图库里出现 IMG_001 这类弱语义文件名。")
      .addToggle((toggle) =>
        toggle.setValue(this.renameImages).onChange((value) => {
          this.renameImages = value;
        })
      );

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = footer.createEl("button", { cls: "aio-btn aio-btn-primary", text: "开始整理" });
    submitBtn.addEventListener("click", async () => {
      submitBtn.disabled = true;
      submitBtn.setText("整理中…");
      try {
        await this.onSubmit({
          targetFolder: this.targetFolder,
          renameImages: this.renameImages,
        });
        this.close();
      } catch {
        submitBtn.disabled = false;
        submitBtn.setText("重试");
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
      text: `未引用附件（${this.orphans.length} 个）`,
    });
    contentEl.createDiv({
      cls: "aio-modal-sub",
      text: "以下文件没有被任何笔记引用。可移到「未引用附件」文件夹（不删除，安全）。",
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
      contentEl.createDiv({ cls: "aio-modal-sub", text: `…等共 ${this.orphans.length} 个` });
    }

    const footer = contentEl.createDiv({ cls: "aio-modal-footer" });
    const cancelBtn = footer.createEl("button", { cls: "aio-btn aio-btn-ghost", text: "关闭" });
    cancelBtn.addEventListener("click", () => this.close());
    const moveBtn = footer.createEl("button", {
      cls: "aio-btn aio-btn-warn",
      text: `移到「未引用附件」(${this.orphans.length})`,
    });
    moveBtn.addEventListener("click", async () => {
      moveBtn.disabled = true;
      moveBtn.setText("移动中…");
      try {
        await this.onMove(this.orphans);
        this.close();
      } catch (err: any) {
        moveBtn.disabled = false;
        moveBtn.setText("重试");
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
