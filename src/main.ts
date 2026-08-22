import { Editor, EditorPosition, MarkdownView, Notice, Plugin, TFile, setIcon } from "obsidian";
import { StateEffect } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  AIOAnnotation,
  AIOrganizerSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from "./settings";
import { createProviders, getActiveProvider } from "./providers";
import type { ModelProvider } from "./types";
import type { TextEditOp } from "./types";
import { ChatService } from "./core/chatService";
import { FormattingService } from "./core/formatting";
import { ImageOrganizer } from "./core/imageOrganizer";
import { MetadataGenerator } from "./core/metadataGenerator";
import { InboxOrganizer } from "./core/inboxOrganizer";
import { LinkSuggester } from "./core/linkSuggester";
import { BatchProcessor } from "./core/batchProcessor";
import { Translator } from "./core/translator";
import { TextEditor } from "./core/textEditor";
import { ChatView, CHAT_VIEW_TYPE } from "./ui/chatView";
import { AIOrganizerSettingTab } from "./ui/settingsTab";
import { FormattingPreviewModal } from "./ui/formattingModal";
import { InboxConfirmModal } from "./ui/inboxModal";
import { LinkSuggestModal } from "./ui/linkModal";
import { BatchModal } from "./ui/batchModal";
import { ImageOrganizeModal, ImageResultModal, OrphanModal } from "./ui/imageModals";
import { TextEditModal } from "./ui/textEditModal";

// ============================================================
// AI Organizer - 主入口
// ============================================================

export interface AIOSelectionSnapshot {
  text: string;
  filePath: string;
  from: { line: number; ch: number };
  to: { line: number; ch: number };
  createdAt: number;
}

const annotationRefreshEffect = StateEffect.define<void>();

class AnnotationMarkerWidget extends WidgetType {
  constructor(
    private readonly plugin: AIOrganizerPlugin,
    private readonly annotations: AIOAnnotation[]
  ) {
    super();
  }

  eq(other: AnnotationMarkerWidget): boolean {
    return this.annotations.map((item) => item.id).join("|") === other.annotations.map((item) => item.id).join("|");
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "aio-annotation-marker";
    marker.title = `便签 ${this.annotations.length} 条`;
    marker.setAttribute("aria-label", marker.title);
    marker.textContent = this.annotations.length > 1 ? String(this.annotations.length) : "";
    marker.addEventListener("mousedown", (evt) => evt.preventDefault());
    marker.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.plugin.showAnnotationThread(this.annotations[0].filePath, this.annotations[0].quote);
    });
    return marker;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export default class AIOrganizerPlugin extends Plugin {
  settings!: AIOrganizerSettings;
  providers!: ModelProvider[];
  chatService!: ChatService;
  formatting!: FormattingService;
  imageOrganizer!: ImageOrganizer;
  metadataGenerator!: MetadataGenerator;
  inboxOrganizer!: InboxOrganizer;
  linkSuggester!: LinkSuggester;
  batchProcessor!: BatchProcessor;
  translator!: Translator;
  textEditor!: TextEditor;
  private selectionToolbarEl: HTMLElement | null = null;
  private translationPopupEl: HTMLElement | null = null;
  private selectionSnapshot: AIOSelectionSnapshot | null = null;
  private editUndoPillEl: HTMLElement | null = null;
  private editUndoTimer: number | null = null;
  private formattingInProgress = false;
  private selectionToolbarSuppressedUntil = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.providers = createProviders(() => this.settings);

    // 初始化服务
    this.chatService = new ChatService(this);
    this.formatting = new FormattingService(this);
    this.imageOrganizer = new ImageOrganizer(this);
    this.metadataGenerator = new MetadataGenerator(this);
    this.inboxOrganizer = new InboxOrganizer(this);
    this.linkSuggester = new LinkSuggester(this);
    this.batchProcessor = new BatchProcessor(this);
    this.translator = new Translator(this);
    this.textEditor = new TextEditor(this);

    // 注册对话面板视图
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // 功能区图标
    this.addRibbonIcon("bot", "AI Organizer — 打开 AI 对话", () => {
      void this.activateChatView();
    });
    this.addRibbonIcon("settings-2", "AI Organizer — 打开设置", () => {
      this.openSettings();
    });

    this.registerCommands();
    this.registerSelectionToolbar();
    this.registerEditorExtension(this.annotationExtension());
    this.addSettingTab(new AIOrganizerSettingTab(this.app, this));

    // 排版前校验配置（温和提示）
    if (!getActiveProvider(this.settings, this.providers)) {
      new Notice("AI Organizer：尚未配置模型，请到设置中填写 API Key");
    }
  }

  onunload(): void {
    this.selectionToolbarEl?.remove();
    this.selectionToolbarEl = null;
    this.translationPopupEl?.remove();
    this.translationPopupEl = null;
    this.hideEditUndoPill();
    // 清理视图
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
  }

  // ---------------- 命令注册 ----------------

  private registerCommands(): void {
    const app = this;

    this.addCommand({
      id: "open-chat",
      name: "打开 AI 对话面板",
      callback: () => app.activateChatView(),
    });

    this.addCommand({
      id: "close-chat",
      name: "关闭 AI 对话侧边栏",
      callback: () => void app.closeChatView(),
    });

    this.addCommand({
      id: "open-settings",
      name: "打开 AI Organizer 设置",
      callback: () => app.openSettings(),
    });

    this.addCommand({
      id: "format-active-note",
      name: "AI 排版当前笔记",
      callback: () => app.formatNote(),
    });

    this.addCommand({
      id: "organize-active-images",
      name: "一键整理当前笔记的图片",
      callback: () => app.organizeImages(),
    });

    this.addCommand({
      id: "find-orphan-attachments",
      name: "扫描未引用附件",
      callback: () => app.scanOrphans(),
    });

    this.addCommand({
      id: "generate-note-metadata",
      name: "AI 生成标签/摘要/别名",
      callback: () => app.generateMetadata(),
    });

    this.addCommand({
      id: "organize-inbox",
      name: "智能整理收件箱",
      callback: () => app.organizeInbox(),
    });

    this.addCommand({
      id: "suggest-links",
      name: "AI 推荐相关笔记（双链）",
      callback: () => app.suggestLinks(),
    });

    this.addCommand({
      id: "batch-process",
      name: "批量 AI 处理",
      callback: () => app.batchProcess(),
    });

    this.addCommand({
      id: "translate-selection",
      name: "AI 翻译选中文本",
      editorCallback: (_editor, view) => {
        if (!view.editor) {
          new Notice("请先在编辑器中选中要翻译的文本");
          return;
        }
        const sel = view.editor.getSelection();
        if (!sel) {
          new Notice("请先在编辑器中选中要翻译的文本");
          return;
        }
        void app.translateText(sel);
      },
    });

    this.addCommand({
      id: "edit-selection",
      name: "AI 编辑选中文本（润色/扩写/续写/压缩）",
      editorCallback: (_editor, view) => {
        if (!view.editor) {
          new Notice("请先在编辑器中选中要编辑的文本");
          return;
        }
        const sel = view.editor.getSelection();
        if (!sel) {
          new Notice("请先在编辑器中选中要编辑的文本");
          return;
        }
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        const editor = mdView?.editor ?? null;
        new TextEditModal(
          this.app,
          sel,
          (text, op) => this.textEditor.transform(text, op),
          async (result) => {
            if (editor) {
              this.applyReplacement(editor, editor.getCursor("from"), editor.getCursor("to"), result, "已应用到选中文本");
            }
          }
        ).open();
      },
    });
  }

  // ---------------- 功能入口 ----------------

  async activateChatView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      leaf = rightLeaf;
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async closeChatView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    for (const leaf of leaves) {
      await leaf.detach();
    }
  }

  getSelectionSnapshot(): AIOSelectionSnapshot | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || !this.selectionSnapshot) return null;
    return this.selectionSnapshot.filePath === activeFile.path ? this.selectionSnapshot : null;
  }

  clearSelectionSnapshot(): void {
    this.selectionSnapshot = null;
    this.hideSelectionToolbar();
  }

  private registerSelectionToolbar(): void {
    const scheduleUpdate = () => window.setTimeout(() => this.updateSelectionToolbar(), 0);
    this.registerDomEvent(document, "mouseup", scheduleUpdate);
    this.registerDomEvent(document, "keyup", (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        this.hideSelectionToolbar();
        this.hideTranslationPopup();
        return;
      }
      if (evt.key.startsWith("Arrow") || evt.key === "Shift" || evt.key === "Home" || evt.key === "End") {
        scheduleUpdate();
      }
    });
    this.registerDomEvent(document, "mousedown", (evt: MouseEvent) => {
      const target = evt.target;
      if (target instanceof Node && this.selectionToolbarEl?.contains(target)) return;
      if (target instanceof Node && this.translationPopupEl?.contains(target)) return;
      this.hideSelectionToolbar();
      this.hideTranslationPopup();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.hideSelectionToolbar();
        this.hideTranslationPopup();
        this.hideEditUndoPill();
      })
    );
  }

  private updateSelectionToolbar(): void {
    if (Date.now() < this.selectionToolbarSuppressedUntil) {
      this.selectionToolbarEl?.removeClass("is-visible");
      return;
    }
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (this.selectionToolbarEl?.contains(active) || this.translationPopupEl?.contains(active))
    ) {
      return;
    }
    const activeInEditor = active instanceof HTMLElement && !!active.closest(".cm-editor, .markdown-source-view");
    if (
      !activeInEditor &&
      (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active instanceof HTMLSelectElement)
    ) {
      this.hideSelectionToolbar();
      return;
    }

    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = mdView?.file;
    if (!mdView?.editor || !(file instanceof TFile) || file.extension !== "md") {
      this.hideSelectionToolbar();
      return;
    }

    const selected = mdView.editor.getSelection().trim();
    if (!selected) {
      this.hideSelectionToolbar();
      return;
    }

    this.selectionSnapshot = {
      text: selected,
      filePath: file.path,
      from: mdView.editor.getCursor("from"),
      to: mdView.editor.getCursor("to"),
      createdAt: Date.now(),
    };

    const toolbar = this.ensureSelectionToolbar();
    toolbar.addClass("is-visible");
    this.positionSelectionToolbar(toolbar);
  }

  private ensureSelectionToolbar(): HTMLElement {
    if (this.selectionToolbarEl) return this.selectionToolbarEl;

    const toolbar = document.body.createDiv({ cls: "aio-selection-toolbar" });
    toolbar.createSpan({ cls: "aio-selection-origin", text: "选中文字" });
    toolbar.addEventListener("mousedown", (evt) => {
      const target = evt.target;
      if (target instanceof HTMLElement && target.closest(".aio-selection-lang")) return;
      evt.preventDefault();
    });

    const langSelect = this.createSelectionLanguageSelect(toolbar);
    this.createSelectionAction(toolbar, "翻译", "languages", "翻译选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) void this.translateText(snapshot.text, snapshot, langSelect.value || this.settings.translate.defaultTarget);
    });
    this.createSelectionAction(toolbar, "解释", "book-open", "解释选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) void this.askSelectionInChat(snapshot);
    });
    this.createSelectionAction(toolbar, "润色", "wand-2", "润色选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.openSelectionEditModal(snapshot, "polish");
    });
    this.createSelectionAction(toolbar, "扩写", "expand", "扩写选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.openSelectionEditModal(snapshot, "expand");
    });
    this.createSelectionAction(toolbar, "总结", "list", "总结选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.openSelectionEditModal(snapshot, "summarize");
    });
    this.createSelectionAction(toolbar, "便签", "sticky-note", "给选中文本插入自己的想法", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.showThoughtNotePopup(snapshot);
    });
    this.createSelectionAction(toolbar, "询问", "message-square", "把选中文本放入对话上下文", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) void this.focusSelectionInChat(snapshot);
    });
    const closeBtn = toolbar.createEl("button", {
      cls: "aio-selection-close",
      attr: { type: "button", title: "关闭", "aria-label": "关闭选中文本工具栏" },
    });
    closeBtn.setText("×");
    closeBtn.addEventListener("click", () => this.hideSelectionToolbar());

    this.selectionToolbarEl = toolbar;
    return toolbar;
  }

  private createSelectionLanguageSelect(toolbar: HTMLElement): HTMLSelectElement {
    const wrap = toolbar.createDiv({ cls: "aio-selection-lang" });
    wrap.createSpan({ cls: "aio-selection-lang-label", text: "译为" });
    const select = wrap.createEl("select", {
      cls: "aio-selection-lang-select",
      attr: { title: "设置翻译目标语言", "aria-label": "设置翻译目标语言" },
    });
    for (const lang of this.translationLanguages(this.settings.translate.defaultTarget)) {
      select.createEl("option", { value: lang, text: lang });
    }
    select.value = this.settings.translate.defaultTarget;
    select.addEventListener("mousedown", (evt) => evt.stopPropagation());
    select.addEventListener("click", (evt) => evt.stopPropagation());
    select.addEventListener("change", () => {
      const next = select.value.trim();
      if (!next || next === this.settings.translate.defaultTarget) return;
      this.settings.translate.defaultTarget = next;
      void this.saveSettings();
    });
    return select;
  }

  private createSelectionAction(
    toolbar: HTMLElement,
    label: string,
    icon: string,
    title: string,
    onClick: () => void
  ): void {
    const btn = toolbar.createEl("button", {
      cls: "aio-selection-action",
      attr: { type: "button", title, "aria-label": title },
    });
    setIcon(btn.createSpan({ cls: "aio-selection-action-icon" }), icon);
    btn.createSpan({ text: label });
    btn.addEventListener("click", onClick);
  }

  private positionSelectionToolbar(toolbar: HTMLElement): void {
    const rect = this.selectionDomRect();
    requestAnimationFrame(() => {
      const width = toolbar.offsetWidth || 156;
      const height = toolbar.offsetHeight || 38;
      const preferredLeft = rect ? rect.left + rect.width / 2 - width / 2 : window.innerWidth / 2 - width / 2;
      const left = Math.min(window.innerWidth - width - 8, Math.max(8, preferredLeft));
      const preferredTop = rect ? rect.top - height - 8 : 72;
      const fallbackTop = rect ? rect.bottom + 8 : 72;
      const top = preferredTop >= 8 ? preferredTop : Math.min(window.innerHeight - height - 8, Math.max(8, fallbackTop));
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${top}px`;
    });
  }

  private selectionDomRect(): DOMRect | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  private hideSelectionToolbar(): void {
    this.selectionToolbarSuppressedUntil = Date.now() + 350;
    this.selectionToolbarEl?.removeClass("is-visible");
  }

  private async askSelectionInChat(snapshot: AIOSelectionSnapshot): Promise<void> {
    await this.activateChatView();
    const leaf = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof ChatView) {
      view.askAboutSelection(snapshot.text, snapshot.filePath);
    }
  }

  private async focusSelectionInChat(snapshot: AIOSelectionSnapshot): Promise<void> {
    await this.activateChatView();
    const leaf = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    const view = leaf?.view;
    if (view instanceof ChatView) {
      view.focusWithSelection(snapshot.text, snapshot.filePath);
    }
  }

  private openSelectionEditModal(snapshot: AIOSelectionSnapshot, op: TextEditOp): void {
    new TextEditModal(
      this.app,
      snapshot.text,
      (text, selectedOp) => this.textEditor.transform(text, selectedOp),
      async (result) => this.replaceSnapshotSelection(snapshot, result),
      op
    ).open();
  }

  private async replaceSnapshotSelection(snapshot: AIOSelectionSnapshot, result: string): Promise<void> {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView?.editor || mdView.file?.path !== snapshot.filePath) {
      await navigator.clipboard.writeText(result);
      new Notice("当前选区已变化，结果已复制到剪贴板");
      return;
    }
    this.applyReplacement(mdView.editor, snapshot.from, snapshot.to, result, "已应用到选中文本");
  }

  /** 应用 AI 替换：替换 → 高亮选中修改范围 → 显示撤回按钮（参考 Copilot 的 accept/undo） */
  private applyReplacement(
    editor: Editor,
    from: EditorPosition,
    to: EditorPosition,
    result: string,
    label = "已应用到选中文本"
  ): void {
    editor.replaceRange(result, from, to);
    const newTo = this.positionAfterText(from, result);
    // 高亮：把修改后的内容保持为选中状态（使用主题选中高亮）
    editor.setSelection(from, newTo);
    this.showEditUndoPill(editor, from, newTo);
    new Notice(`${label}（可撤回）`);
    // 短暂高亮后收拢光标，避免后续输入误覆盖
    window.setTimeout(() => {
      const cursor = editor.getCursor();
      if (cursor.line === newTo.line && cursor.ch === newTo.ch) {
        editor.setCursor(newTo);
      }
    }, 1600);
  }

  /** 计算替换文本结束位置 */
  private positionAfterText(from: EditorPosition, text: string): EditorPosition {
    const lines = text.split("\n");
    if (lines.length <= 1) {
      return { line: from.line, ch: from.ch + (lines[0]?.length ?? 0) };
    }
    return { line: from.line + lines.length - 1, ch: lines[lines.length - 1].length };
  }

  /** 显示「已应用 · 撤回」浮动按钮，点击一次 undo 即可回退 */
  private showEditUndoPill(editor: Editor, _from: EditorPosition, _to: EditorPosition): void {
    this.hideEditUndoPill();
    const pill = document.body.createDiv({ cls: "aio-edit-undo" });
    setIcon(pill.createSpan({ cls: "aio-edit-undo-icon" }), "check");
    pill.createSpan({ cls: "aio-edit-undo-text", text: "已应用" });
    const undoBtn = pill.createEl("button", { cls: "aio-edit-undo-btn", text: "撤回" });
    undoBtn.title = "撤销本次修改（也可用 Ctrl+Z）";
    undoBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
    undoBtn.addEventListener("click", () => {
      try {
        editor.undo();
      } catch {
        /* ignore */
      }
      this.hideEditUndoPill();
    });
    this.editUndoPillEl = pill;
    pill.addClass("is-visible");
    requestAnimationFrame(() => {
      const rect = this.selectionDomRect();
      const width = pill.offsetWidth || 150;
      const height = pill.offsetHeight || 38;
      const left = rect ? Math.max(8, Math.min(window.innerWidth - width - 8, rect.left)) : 8;
      const top = rect ? Math.max(8, rect.top - height - 8) : 48;
      pill.style.left = `${left}px`;
      pill.style.top = `${top}px`;
    });
    if (this.editUndoTimer) window.clearTimeout(this.editUndoTimer);
    this.editUndoTimer = window.setTimeout(() => this.hideEditUndoPill(), 8000);
  }

  private hideEditUndoPill(): void {
    this.editUndoPillEl?.remove();
    this.editUndoPillEl = null;
    if (this.editUndoTimer) {
      window.clearTimeout(this.editUndoTimer);
      this.editUndoTimer = null;
    }
  }

  openSettings(): void {
    const setting = (this.app as any).setting;
    if (!setting) {
      new Notice("请从 Obsidian 设置 → 第三方插件 → AI Organizer 打开配置");
      return;
    }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  async formatNote(): Promise<void> {
    if (this.formattingInProgress) {
      new Notice("排版正在进行中，请稍等…");
      return;
    }
    const mode = this.settings.formatting.mode;
    this.formattingInProgress = true;
    const loadingNotice = new Notice("AI 正在排版当前笔记…", 0);
    let streamedChars = 0;
    let lastNoticeAt = 0;

    try {
      const result = await this.formatting.formatActiveNote(mode, {
        onStream: (delta) => {
          streamedChars += delta.length;
          const now = Date.now();
          if (now - lastNoticeAt > 500) {
            loadingNotice.setMessage(`AI 正在排版当前笔记…已生成 ${streamedChars} 字`);
            lastNoticeAt = now;
          }
        },
      });
      if (!result) return;
      const { file, before, after } = result;

      loadingNotice.setMessage("排版完成，正在打开预览…");
      const apply = async () => {
        await this.app.vault.modify(file, after);
        new Notice(`「${file.basename}」排版完成`);
      };

      if (this.settings.formatting.previewBeforeApply) {
        new FormattingPreviewModal(this.app, file, before, after, apply).open();
      } else {
        await apply();
      }
    } catch (err: any) {
      new Notice(`排版失败：${err?.message || err}`, 8000);
    } finally {
      loadingNotice.hide();
      this.formattingInProgress = false;
    }
  }

  async organizeImages(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      new Notice("请先打开一篇 Markdown 笔记");
      return;
    }
    const defaultTarget = this.imageOrganizer.targetFolderFor(file);
    new ImageOrganizeModal(
      this.app,
      defaultTarget,
      this.settings.imageOrg.renameImages,
      async (opts) => {
        const result = await this.imageOrganizer.organizeNote(file, opts);
        new ImageResultModal(this.app, result).open();
      }
    ).open();
  }

  async scanOrphans(): Promise<void> {
    new Notice("正在扫描未引用附件…");
    const orphans = await this.imageOrganizer.findOrphans();
    if (orphans.length === 0) {
      new Notice("没有未引用的附件，库很干净 🎉");
      return;
    }
    new OrphanModal(this.app, orphans, async (files) => {
      const moved = await this.imageOrganizer.moveOrphansToTrash(files);
      new Notice(`已移动 ${moved} 个未引用附件到「未引用附件」文件夹`);
    }).open();
  }

  async generateMetadata(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      new Notice("请先打开一篇 Markdown 笔记");
      return;
    }
    new Notice("AI 正在生成元数据…");
    await this.metadataGenerator.applyToNote(file);
  }

  async organizeInbox(): Promise<void> {
    const notes = this.inboxOrganizer.listInboxNotes();
    if (notes.length === 0) {
      new Notice(`收件箱「${this.settings.inbox.inboxFolder}」中没有笔记`);
      return;
    }
    new Notice(`正在让 AI 分析 ${notes.length} 篇收件箱笔记…`);
    try {
      const suggestions = await this.inboxOrganizer.suggestMoves(notes);
      new InboxConfirmModal(this.app, suggestions, async (moves) => {
        const { moved, kept } = await this.inboxOrganizer.executeMoves(moves);
        new Notice(`整理完成：移动 ${moved} 篇，保持原位 ${kept} 篇`);
      }).open();
    } catch (err: any) {
      new Notice(`整理失败：${err?.message || err}`, 6000);
    }
  }

  async suggestLinks(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      new Notice("请先打开一篇 Markdown 笔记");
      return;
    }
    new Notice("AI 正在分析相关笔记…");
    try {
      const suggestions = await this.linkSuggester.suggest(file);
      new LinkSuggestModal(this.app, suggestions, async (selected) => {
        await this.linkSuggester.appendLinks(file, selected);
      }).open();
    } catch (err: any) {
      new Notice(`分析失败：${err?.message || err}`, 6000);
    }
  }

  async batchProcess(): Promise<void> {
    new BatchModal(this.app, async (files, op) => {
      await this.runBatch(files, op);
    }).open();
  }

  private async runBatch(
    files: TFile[],
    op: "format" | "metadata" | "translate"
  ): Promise<void> {
    const total = files.length;
    const results = await this.batchProcessor.process(files, op, (done) => {
      new Notice(`批量处理中… ${done}/${total}`);
    });
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      const detail = failed.map((r) => `${r.file.name}: ${r.message}`).slice(0, 10).join("\n");
      new Notice(`失败 ${failed.length} 篇：\n${detail}`, 10000);
    }
  }

  async translateText(text: string, snapshot?: AIOSelectionSnapshot, targetOverride?: string): Promise<void> {
    const target = targetOverride || this.settings.translate.defaultTarget;
    const sourceText = this.stripOrganizerInlineNotes(text).trim() || text.trim();
    const captured = snapshot ?? this.captureActiveSelectionSnapshot(text);
    this.showTranslationPopup(sourceText, "", captured, true, target);
    try {
      const result = await this.translator.translate(sourceText, target);
      this.showTranslationPopup(sourceText, result, captured, false, target);
    } catch (err: any) {
      this.showTranslationError(err?.message || String(err));
    }
  }

  private captureActiveSelectionSnapshot(text: string): AIOSelectionSnapshot | null {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = mdView?.file;
    if (!mdView?.editor || !(file instanceof TFile)) return null;
    const selected = mdView.editor.getSelection().trim();
    if (!selected || selected !== text.trim()) return null;
    return {
      text: selected,
      filePath: file.path,
      from: mdView.editor.getCursor("from"),
      to: mdView.editor.getCursor("to"),
      createdAt: Date.now(),
    };
  }

  private showTranslationPopup(
    original: string,
    translated: string,
    snapshot: AIOSelectionSnapshot | null,
    loading: boolean,
    targetLang = this.settings.translate.defaultTarget
  ): void {
    const popup = this.ensureTranslationPopup();
    popup.empty();
    popup.addClass("is-visible");

    const head = popup.createDiv({ cls: "aio-translation-head" });
    const title = head.createDiv({ cls: "aio-translation-title" });
    setIcon(title.createSpan({ cls: "aio-translation-title-icon" }), "languages");
    title.createSpan({ text: loading ? "正在翻译" : "翻译结果" });
    if (!loading) {
      const langSelect = title.createEl("select", { cls: "aio-translation-lang", attr: { title: "切换目标语言" } });
      const languages = this.translationLanguages(targetLang);
      for (const lang of languages) {
        langSelect.createEl("option", { value: lang, text: lang });
      }
      langSelect.value = targetLang;
      langSelect.addEventListener("change", () => {
        const next = langSelect.value.trim();
        if (next) void this.translateText(original, snapshot ?? undefined, next);
      });
    }
    const closeBtn = head.createEl("button", {
      cls: "aio-translation-icon-btn",
      attr: { type: "button", title: "关闭", "aria-label": "关闭" },
    });
    closeBtn.setText("×");
    closeBtn.addEventListener("click", () => this.hideTranslationPopup());

    if (loading) {
      const loadingEl = popup.createDiv({ cls: "aio-translation-loading" });
      loadingEl.createSpan({ cls: "aio-spinner" });
      loadingEl.createSpan({ text: `翻译为 ${targetLang}...` });
      this.positionFloatingPanel(popup);
      return;
    }

    popup.createDiv({ cls: "aio-translation-body", text: translated || "未返回翻译内容" });
    const thoughtWrap = popup.createDiv({ cls: "aio-translation-thought" });
    thoughtWrap.createDiv({ cls: "aio-translation-thought-label", text: "自己的想法（可选）" });
    const thoughtEl = thoughtWrap.createEl("textarea", {
      cls: "aio-translation-thought-input",
      attr: {
        rows: "3",
        placeholder: "例如：这里和上一节的概念有关，之后要再查一下原文出处...",
      },
    });
    const existingTranslation = snapshot
      ? this.findAnnotationForSelection(
          snapshot.filePath,
          "translation",
          this.stripOrganizerInlineNotes(snapshot.text).trim() || snapshot.text.trim()
        )
      : undefined;
    if (existingTranslation?.thought) {
      thoughtEl.value = existingTranslation.thought;
    }
    const actions = popup.createDiv({ cls: "aio-translation-actions" });
    const replaceBtn = actions.createEl("button", {
      cls: "aio-translation-action is-primary",
      text: "替换原文",
      attr: { type: "button" },
    });
    replaceBtn.disabled = !snapshot;
    replaceBtn.addEventListener("click", () => {
      if (!snapshot) return;
      void this.replaceSnapshotSelection(snapshot, translated);
      this.hideTranslationPopup();
    });

    const copyBtn = actions.createEl("button", {
      cls: "aio-translation-action",
      text: "复制",
      attr: { type: "button" },
    });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(translated);
      new Notice("翻译内容已复制");
    });

    const saveBtn = actions.createEl("button", {
      cls: "aio-translation-action",
      text: existingTranslation ? "更新便签" : "保存便签",
      attr: { type: "button" },
    });
    saveBtn.disabled = !snapshot;
    saveBtn.addEventListener("click", async () => {
      if (!snapshot) return;
      await this.insertTranslationNote(translated, thoughtEl.value, targetLang, snapshot);
      this.hideTranslationPopup();
    });

    this.positionFloatingPanel(popup);
  }

  private translationLanguages(active: string): string[] {
    return Array.from(
      new Set([active, this.settings.translate.defaultTarget, ...(this.settings.translate.targetLanguages ?? [])].map((item) => item.trim()).filter(Boolean))
    );
  }

  private ensureTranslationPopup(): HTMLElement {
    if (this.translationPopupEl) return this.translationPopupEl;
    const popup = document.body.createDiv({ cls: "aio-translation-popover" });
    popup.addEventListener("mousedown", (evt) => {
      const target = evt.target;
      if (
        target instanceof HTMLElement &&
        target.closest("button, input, textarea, select, .aio-translation-body, .aio-annotation-body")
      ) {
        return;
      }
      evt.preventDefault();
    });
    this.translationPopupEl = popup;
    return popup;
  }

  private showTranslationError(message: string): void {
    const popup = this.ensureTranslationPopup();
    popup.empty();
    popup.addClass("is-visible");
    popup.createDiv({ cls: "aio-translation-title", text: "翻译失败" });
    popup.createDiv({ cls: "aio-translation-error", text: message });
    const closeBtn = popup.createEl("button", { cls: "aio-translation-action", text: "关闭" });
    closeBtn.addEventListener("click", () => this.hideTranslationPopup());
    this.positionFloatingPanel(popup);
  }

  private showThoughtNotePopup(snapshot: AIOSelectionSnapshot): void {
    const popup = this.ensureTranslationPopup();
    popup.empty();
    popup.addClass("is-visible");

    const head = popup.createDiv({ cls: "aio-translation-head" });
    const title = head.createDiv({ cls: "aio-translation-title" });
    setIcon(title.createSpan({ cls: "aio-translation-title-icon" }), "sticky-note");
    title.createSpan({ text: "插入便签" });
    const closeBtn = head.createEl("button", {
      cls: "aio-translation-icon-btn",
      attr: { type: "button", title: "关闭", "aria-label": "关闭" },
    });
    closeBtn.setText("×");
    closeBtn.addEventListener("click", () => this.hideTranslationPopup());

    const quote = this.stripOrganizerInlineNotes(snapshot.text).trim() || snapshot.text.trim();
    const existingThoughts = this.findRelatedAnnotations(snapshot.filePath, "thought", quote);
    const existingTranslations = this.findRelatedAnnotations(snapshot.filePath, "translation", quote);
    const isEditing = existingThoughts.length > 0;

    if (isEditing || existingTranslations.length > 0) {
      const existing = popup.createDiv({ cls: "aio-annotation-existing" });
      existing.createDiv({
        cls: "aio-annotation-existing-title",
        text: isEditing ? "正在修改这段文字的便签" : "这段文字已有翻译便签",
      });
      existing.createDiv({
        cls: "aio-annotation-existing-item",
        text: "保存后会更新原有便签，不会新增一条。",
      });
    }

    const thoughtWrap = popup.createDiv({ cls: "aio-translation-thought" });
    thoughtWrap.createDiv({ cls: "aio-translation-thought-label", text: "自己的想法" });
    const thoughtEl = thoughtWrap.createEl("textarea", {
      cls: "aio-translation-thought-input",
      attr: {
        rows: "5",
        placeholder: "写下你对这段文字的批注、疑问、联想、待办...",
      },
    });
    thoughtEl.value = this.combineThoughts(existingThoughts);

    const actions = popup.createDiv({ cls: "aio-translation-actions" });
    const insertBtn = actions.createEl("button", {
      cls: "aio-translation-action is-primary",
      text: isEditing ? "保存修改" : "保存想法",
      attr: { type: "button" },
    });
    insertBtn.addEventListener("click", async () => {
      await this.insertThoughtNote(thoughtEl.value, snapshot);
      this.hideTranslationPopup();
    });
    this.positionFloatingPanel(popup);
    thoughtEl.focus();
  }

  private hideTranslationPopup(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.translationPopupEl?.contains(active)) {
      active.blur();
    }
    this.translationPopupEl?.removeClass("is-visible");
  }

  private positionFloatingPanel(panel: HTMLElement): void {
    const rect = this.selectionDomRect();
    requestAnimationFrame(() => {
      const width = panel.offsetWidth || 320;
      const height = panel.offsetHeight || 240;
      const preferredLeft = rect ? rect.left + rect.width / 2 - width / 2 : window.innerWidth / 2 - width / 2;
      const left = Math.min(window.innerWidth - width - 10, Math.max(10, preferredLeft));
      const belowTop = rect ? rect.bottom + 10 : 80;
      const aboveTop = rect ? rect.top - height - 10 : 80;
      const preferredTop = belowTop + height <= window.innerHeight - 10 ? belowTop : aboveTop;
      const top = Math.min(window.innerHeight - height - 10, Math.max(10, preferredTop));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });
  }

  private async insertTranslationNote(
    translated: string,
    thought: string,
    targetLang: string,
    snapshot: AIOSelectionSnapshot
  ): Promise<void> {
    await this.saveAnnotation({
      snapshot,
      type: "translation",
      translated,
      thought,
      targetLang,
    });
    new Notice("翻译便签已保存（未写入正文）");
  }

  private async insertThoughtNote(thought: string, snapshot: AIOSelectionSnapshot): Promise<void> {
    const cleanedThought = thought.trim();
    if (!cleanedThought) {
      new Notice("请先写一点想法");
      return;
    }
    await this.saveAnnotation({
      snapshot,
      type: "thought",
      thought: cleanedThought,
    });
    new Notice("便签已保存（未写入正文）");
  }

  private async saveAnnotation(opts: {
    snapshot: AIOSelectionSnapshot;
    type: "translation" | "thought";
    translated?: string;
    thought?: string;
    targetLang?: string;
  }): Promise<void> {
    const quote = this.stripOrganizerInlineNotes(opts.snapshot.text).trim() || opts.snapshot.text.trim();
    let existing = this.findAnnotationForSelection(opts.snapshot.filePath, opts.type, quote);
    const now = Date.now();
    if (existing) {
      existing.quote = quote;
      existing.translated = opts.translated;
      existing.thought = opts.thought;
      existing.targetLang = opts.targetLang;
      existing.updatedAt = now;
    } else {
      const annotation: AIOAnnotation = {
        id: `annotation-${now}-${Math.random().toString(36).slice(2, 8)}`,
        filePath: opts.snapshot.filePath,
        quote,
        type: opts.type,
        translated: opts.translated,
        thought: opts.thought,
        targetLang: opts.targetLang,
        createdAt: now,
        updatedAt: now,
      };
      this.settings.annotations.push(annotation);
      existing = annotation;
    }
    this.settings.annotations = this.settings.annotations.filter((item) => {
      if (item === existing) return true;
      if (item.filePath !== opts.snapshot.filePath || item.type !== opts.type) return true;
      return !(quote.includes(item.quote) || item.quote.includes(quote));
    });
    await this.saveSettings();
    this.refreshAnnotationDecorations();
    this.showAnnotationPill(opts.snapshot, opts.type);
  }

  private findAnnotationForSelection(
    filePath: string,
    type: "translation" | "thought",
    quote: string
  ): AIOAnnotation | undefined {
    return this.findRelatedAnnotations(filePath, type, quote)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  private findRelatedAnnotations(
    filePath: string,
    type: "translation" | "thought",
    quote: string
  ): AIOAnnotation[] {
    return this.settings.annotations.filter(
      (item) =>
        item.filePath === filePath &&
        item.type === type &&
        (item.quote === quote || quote.includes(item.quote) || item.quote.includes(quote))
    );
  }

  private combineThoughts(items: AIOAnnotation[]): string {
    return Array.from(
      new Set(
        items
          .slice()
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((item) => item.thought?.trim())
          .filter((item): item is string => !!item)
      )
    ).join("\n\n");
  }

  private relatedAnnotations(snapshot: AIOSelectionSnapshot): AIOAnnotation[] {
    const selected = this.stripOrganizerInlineNotes(snapshot.text).trim();
    return this.settings.annotations.filter(
      (item) =>
        item.filePath === snapshot.filePath &&
        (selected.includes(item.quote) || item.quote.includes(selected))
    );
  }

  private showAnnotationPill(snapshot: AIOSelectionSnapshot, type: "translation" | "thought"): void {
    const pill = document.body.createDiv({ cls: "aio-edit-undo aio-annotation-pill" });
    setIcon(pill.createSpan({ cls: "aio-edit-undo-icon" }), "sticky-note");
    pill.createSpan({ cls: "aio-edit-undo-text", text: type === "translation" ? "翻译便签已保存" : "便签已保存" });
    const viewBtn = pill.createEl("button", { cls: "aio-edit-undo-btn", text: "查看" });
    viewBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
    viewBtn.addEventListener("click", () => {
      pill.remove();
      this.showThoughtNotePopup(snapshot);
    });
    pill.addClass("is-visible");
    requestAnimationFrame(() => {
      const rect = this.selectionDomRect();
      const width = pill.offsetWidth || 150;
      const height = pill.offsetHeight || 38;
      pill.style.left = `${rect ? Math.max(8, Math.min(window.innerWidth - width - 8, rect.left)) : 8}px`;
      pill.style.top = `${rect ? Math.max(8, rect.top - height - 8) : 48}px`;
    });
    window.setTimeout(() => pill.remove(), 6000);
  }

  private annotationExtension(): Extension {
    const plugin = this;
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = plugin.buildAnnotationDecorations(view);
        }

        update(update: ViewUpdate): void {
          const shouldRefresh =
            update.docChanged ||
            update.viewportChanged ||
            update.transactions.some((transaction) =>
              transaction.effects.some((effect) => effect.is(annotationRefreshEffect))
            );
          if (shouldRefresh) {
            this.decorations = plugin.buildAnnotationDecorations(update.view);
          }
        }
      },
      {
        decorations: (value) => value.decorations,
      }
    );
  }

  private buildAnnotationDecorations(view: EditorView): DecorationSet {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") return Decoration.none;

    const annotations = this.uniqueAnnotations(
      this.settings.annotations.filter((item) => item.filePath === file.path && item.quote.trim().length > 1)
    );
    if (annotations.length === 0) return Decoration.none;

    const doc = view.state.doc.toString();
    const byRange = new Map<string, { from: number; to: number; annotations: AIOAnnotation[] }>();

    for (const annotation of annotations) {
      const quote = annotation.quote.trim();
      let from = doc.indexOf(quote);
      while (from !== -1) {
        const to = from + quote.length;
        const key = `${from}:${to}`;
        const existing = byRange.get(key);
        if (existing) {
          existing.annotations.push(annotation);
        } else {
          byRange.set(key, { from, to, annotations: [annotation] });
        }
        from = doc.indexOf(quote, from + Math.max(quote.length, 1));
      }
    }

    if (byRange.size === 0) return Decoration.none;

    const decorations: Array<{ from: number; to: number; value: Decoration }> = [];
    for (const range of byRange.values()) {
      decorations.push({
        from: range.from,
        to: range.to,
        value: Decoration.mark({ class: "aio-annotation-highlight" }),
      });
      decorations.push({
        from: range.to,
        to: range.to,
        value: Decoration.widget({
          widget: new AnnotationMarkerWidget(this, range.annotations),
          side: 1,
        }),
      });
    }

    return Decoration.set(decorations, true);
  }

  private refreshAnnotationDecorations(): void {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = (mdView?.editor as unknown as { cm?: EditorView }).cm;
    cm?.dispatch({ effects: annotationRefreshEffect.of() });
    window.requestAnimationFrame(() => cm?.dispatch({ effects: annotationRefreshEffect.of() }));
    window.setTimeout(() => cm?.dispatch({ effects: annotationRefreshEffect.of() }), 80);
  }

  private async pruneMissingAnnotations(file: TFile): Promise<boolean> {
    const content = await this.app.vault.cachedRead(file);
    const before = this.settings.annotations.length;
    this.settings.annotations = this.settings.annotations.filter((item) => {
      if (item.filePath !== file.path) return true;
      return item.quote.trim().length > 1 && content.includes(item.quote.trim());
    });
    if (this.settings.annotations.length === before) return false;
    await this.saveSettings();
    this.refreshAnnotationDecorations();
    return true;
  }

  private uniqueAnnotations(items: AIOAnnotation[]): AIOAnnotation[] {
    const byAnchor = new Map<string, AIOAnnotation>();
    for (const item of items) {
      const key = `${item.filePath}\u0000${item.type}\u0000${item.quote}`;
      const existing = byAnchor.get(key);
      if (!existing || item.updatedAt > existing.updatedAt) {
        byAnchor.set(key, item);
      }
    }
    return Array.from(byAnchor.values());
  }

  showAnnotationThread(filePath: string, quote: string): void {
    const annotations = this.uniqueAnnotations(
      this.settings.annotations.filter((item) => item.filePath === filePath && item.quote === quote)
    );
    if (annotations.length === 0) {
      this.hideTranslationPopup();
      new Notice("这段文字还没有便签");
      return;
    }

    const popup = this.ensureTranslationPopup();
    popup.empty();
    popup.addClass("is-visible");

    const head = popup.createDiv({ cls: "aio-translation-head" });
    const title = head.createDiv({ cls: "aio-translation-title" });
    setIcon(title.createSpan({ cls: "aio-translation-title-icon" }), "sticky-note");
    title.createSpan({ text: "编辑便签" });
    const closeBtn = head.createEl("button", {
      cls: "aio-translation-icon-btn",
      attr: { type: "button", title: "关闭", "aria-label": "关闭" },
    });
    closeBtn.setText("×");
    closeBtn.addEventListener("click", () => this.hideTranslationPopup());

    const translation = annotations
      .filter((item) => item.type === "translation" && item.translated)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (translation?.translated) {
      const result = popup.createDiv({ cls: "aio-annotation-result" });
      const resultHead = result.createDiv({ cls: "aio-annotation-card-head" });
      const resultMeta = resultHead.createDiv({ cls: "aio-annotation-meta" });
      resultMeta.createSpan({
        cls: "aio-annotation-kind",
        text: translation.targetLang ? `翻译 · ${translation.targetLang}` : "翻译",
      });
      resultMeta.createSpan({ cls: "aio-annotation-time", text: new Date(translation.updatedAt).toLocaleString() });
      const deleteTranslationBtn = resultHead.createEl("button", {
        cls: "aio-annotation-mini-btn is-danger",
        attr: { type: "button", title: "删除翻译便签", "aria-label": "删除翻译便签" },
      });
      setIcon(deleteTranslationBtn.createSpan({ cls: "aio-annotation-mini-btn-icon" }), "trash-2");
      deleteTranslationBtn.addEventListener("click", async (evt) => {
        evt.stopPropagation();
        await this.deleteAnnotation(translation.id, () => this.showAnnotationThread(filePath, quote));
      });
      result.createDiv({ cls: "aio-annotation-body", text: translation.translated });
    }

    const composer = popup.createDiv({ cls: "aio-annotation-composer" });
    composer.createDiv({ cls: "aio-translation-thought-label", text: "自己的想法" });
    const existingThoughts = this.settings.annotations.filter(
      (item) => item.filePath === filePath && item.type === "thought" && item.quote === quote
    );
    const thoughtEl = composer.createEl("textarea", {
      cls: "aio-translation-thought-input",
      attr: {
        rows: "5",
        placeholder: "写下或修改你的理解、疑问、关联线索...",
      },
    });
    thoughtEl.value = this.combineThoughts(existingThoughts);
    const actions = popup.createDiv({ cls: "aio-translation-actions" });
    if (existingThoughts.length > 0) {
      const deleteThoughtBtn = actions.createEl("button", {
        cls: "aio-translation-action is-danger",
        text: "删除想法",
        attr: { type: "button" },
      });
      deleteThoughtBtn.addEventListener("click", async () => {
        if (!confirm("确定删除这段文字的想法便签吗？")) return;
        for (const item of existingThoughts) {
          await this.deleteAnnotation(item.id, undefined, false, false);
        }
        new Notice("已删除想法便签");
        this.showAnnotationThread(filePath, quote);
      });
    }
    const addBtn = actions.createEl("button", {
      cls: "aio-translation-action is-primary",
      text: thoughtEl.value.trim() ? "保存修改" : "保存想法",
      attr: { type: "button" },
    });
    addBtn.addEventListener("click", async () => {
      const thought = thoughtEl.value.trim();
      if (!thought) {
        new Notice("请先写一点想法");
        return;
      }
      await this.saveAnnotation({
        snapshot: this.snapshotForAnnotation(filePath, quote),
        type: "thought",
        thought,
      });
      this.showAnnotationThread(filePath, quote);
    });

    this.positionFloatingPanel(popup);
    thoughtEl.focus();
  }

  openAnnotationPanel(): void {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("先打开一篇 Markdown 笔记");
      return;
    }
    void this.pruneMissingAnnotations(file).then((changed) => {
      if (changed && this.translationPopupEl?.hasClass("is-visible")) {
        this.openAnnotationPanel();
      }
    });

    const annotations = this.uniqueAnnotations(this.settings.annotations.filter((item) => item.filePath === file.path))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const popup = this.ensureTranslationPopup();
    popup.empty();
    popup.addClass("is-visible");

    const head = popup.createDiv({ cls: "aio-translation-head" });
    const title = head.createDiv({ cls: "aio-translation-title" });
    setIcon(title.createSpan({ cls: "aio-translation-title-icon" }), "sticky-note");
    title.createSpan({ text: "当前笔记便签" });
    const closeBtn = head.createEl("button", {
      cls: "aio-translation-icon-btn",
      attr: { type: "button", title: "关闭", "aria-label": "关闭" },
    });
    closeBtn.setText("×");
    closeBtn.addEventListener("click", () => this.hideTranslationPopup());

    if (annotations.length === 0) {
      const empty = popup.createDiv({ cls: "aio-annotation-empty" });
      empty.createDiv({ cls: "aio-annotation-empty-title", text: "这篇笔记还没有便签" });
      empty.createDiv({ cls: "aio-annotation-empty-desc", text: "在正文里选中文字后，点“便签”或“翻译”即可保存批注。" });
      this.positionFloatingPanel(popup);
      return;
    }

    popup.createDiv({
      cls: "aio-annotation-panel-summary",
      text: `${annotations.length} 条便签，点击卡片编辑，右侧可删除。`,
    });
    const list = popup.createDiv({ cls: "aio-annotation-panel-list" });
    for (const item of annotations) {
      const row = list.createDiv({
        cls: "aio-annotation-panel-item",
      });
      row.setAttr("role", "button");
      row.setAttr("tabindex", "0");
      row.setAttr("aria-label", "打开便签");
      const top = row.createDiv({ cls: "aio-annotation-panel-item-head" });
      const meta = top.createDiv({ cls: "aio-annotation-meta" });
      meta.createSpan({ cls: "aio-annotation-kind", text: item.type === "translation" ? "翻译" : "想法" });
      meta.createSpan({ cls: "aio-annotation-time", text: new Date(item.updatedAt).toLocaleString() });
      const rowActions = top.createDiv({ cls: "aio-annotation-row-actions" });
      const editBtn = rowActions.createEl("button", {
        cls: "aio-annotation-mini-btn",
        attr: { type: "button", title: "编辑便签", "aria-label": "编辑便签" },
      });
      setIcon(editBtn.createSpan({ cls: "aio-annotation-mini-btn-icon" }), "edit-3");
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.showAnnotationThread(item.filePath, item.quote);
      });
      const deleteBtn = rowActions.createEl("button", {
        cls: "aio-annotation-mini-btn is-danger",
        attr: { type: "button", title: "删除便签", "aria-label": "删除便签" },
      });
      setIcon(deleteBtn.createSpan({ cls: "aio-annotation-mini-btn-icon" }), "trash-2");
      deleteBtn.addEventListener("click", async (evt) => {
        evt.stopPropagation();
        await this.deleteAnnotation(item.id, () => this.openAnnotationPanel());
      });
      row.createDiv({
        cls: "aio-annotation-panel-body",
        text: item.thought || item.translated || "打开后编辑便签内容",
      });
      row.addEventListener("click", () => this.showAnnotationThread(item.filePath, item.quote));
      row.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          this.showAnnotationThread(item.filePath, item.quote);
        }
      });
    }

    this.positionFloatingPanel(popup);
  }

  private async deleteAnnotation(id: string, after?: () => void, ask = true, notify = true): Promise<void> {
    const item = this.settings.annotations.find((annotation) => annotation.id === id);
    if (!item) {
      new Notice("这条便签已经不存在");
      return;
    }
    if (ask && !confirm("确定删除这条便签吗？")) return;
    this.settings.annotations = this.settings.annotations.filter((annotation) => annotation.id !== id);
    await this.saveSettings();
    this.refreshAnnotationDecorations();
    if (notify) new Notice("已删除便签");
    after?.();
  }

  private snapshotForAnnotation(filePath: string, quote: string): AIOSelectionSnapshot {
    return {
      text: quote,
      filePath,
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: 0 },
      createdAt: Date.now(),
    };
  }

  private translationCallout(translated: string, thought: string): string {
    const quoted = translated
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const thoughtBlock = thought.trim()
      ? `>\n> **我的想法**\n${thought
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}\n`
      : "";
    return `\n\n<!-- aio-note:translation -->\n> [!note] 翻译便签\n${quoted}\n${thoughtBlock}<!-- /aio-note -->\n`;
  }

  private thoughtCallout(thought: string): string {
    const quoted = thought
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return `\n\n<!-- aio-note:thought -->\n> [!note] 我的想法\n${quoted}\n<!-- /aio-note -->\n`;
  }

  private stripOrganizerInlineNotes(text: string): string {
    return text
      .replace(/\n*<!-- aio-note:(?:translation|thought) -->[\s\S]*?<!-- \/aio-note -->\n*/g, "\n")
      .replace(/\n{0,2}> \[!note\] 翻译便签\n(?:>.*(?:\n|$))+/g, "\n")
      .trim();
  }

  // ---------------- 设置 ----------------

  async loadSettings(): Promise<void> {
    this.settings = await loadSettings(this);
  }

  async saveSettings(): Promise<void> {
    await saveSettings(this, this.settings);
  }

  /** 确保 vault 内目录存在 */
  async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    if (this.app.vault.getAbstractFileByPath(path)) return;
    await this.app.vault.createFolder(path);
  }
}
