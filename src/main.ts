import { Editor, EditorPosition, MarkdownView, Plugin, TFile, setIcon } from "obsidian";
import { computeQuoteAnchor, findBestPartialMatch, posFromOffset, resolveQuoteRange } from "./utils/position";
import { capScrollPositions, selectionSignature } from "./utils";
import { notify, notifyError, notifyLoading, notifySuccess } from "./utils/notify";
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

function samePosition(a: EditorPosition, b: EditorPosition): boolean {
  return a.line === b.line && a.ch === b.ch;
}

const annotationRefreshEffect = StateEffect.define<void>();

class AnnotationMarkerWidget extends WidgetType {
  constructor(
    private readonly plugin: AIOrganizerPlugin,
    private readonly annotations: AIOAnnotation[],
    private readonly lost = false
  ) {
    super();
  }

  eq(other: AnnotationMarkerWidget): boolean {
    return (
      this.annotations.map((item) => item.id).join("|") ===
        other.annotations.map((item) => item.id).join("|") &&
      this.lost === other.lost
    );
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = this.lost ? "aio-annotation-marker is-lost" : "aio-annotation-marker";
    marker.title = this.lost
      ? "便签位置已失效（原文被修改），点击查看详情"
      : `便签 ${this.annotations.length} 条`;
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
  private notePositions = new Map<string, { top: number; line: number; ch: number }>();
  private scrollEl: HTMLElement | null = null;
  private scrollHandler: (() => void) | null = null;
  private scrollSaveTimer: number | null = null;
  private formattingInProgress = false;
  private selectionToolbarSuppressedUntil = 0;
  private selectionToolbarClosedSignature: string | null = null;
  private annotationPruneTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    // 从磁盘恢复上次会话记录的浏览位置（跨重启持久化）
    this.notePositions = new Map(
      Object.entries(this.settings.scrollRestore.positions ?? {})
    );
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
    this.registerScrollRestore();
    this.addSettingTab(new AIOrganizerSettingTab(this.app, this));

    // 排版前校验配置（温和提示）
    if (!getActiveProvider(this.settings, this.providers)) {
      notify("尚未配置模型，请在设置中填写 API Key");
    }
  }

  onunload(): void {
    this.selectionToolbarEl?.remove();
    this.selectionToolbarEl = null;
    this.translationPopupEl?.remove();
    this.translationPopupEl = null;
    this.hideEditUndoPill();
    // 卸载前把浏览位置落盘，确保最后位置不丢
    if (this.scrollSaveTimer) {
      window.clearTimeout(this.scrollSaveTimer);
      this.scrollSaveTimer = null;
    }
    void this.saveSettings();
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
      id: "restore-last-scroll-position",
      name: "回到上次浏览位置",
      callback: () => app.restoreCurrentScrollPosition(true),
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
          notify("请先在编辑器中选中文本");
          return;
        }
        const sel = view.editor.getSelection();
        if (!sel) {
          notify("请先在编辑器中选中文本");
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
          notify("请先在编辑器中选中文本");
          return;
        }
        const sel = view.editor.getSelection();
        if (!sel) {
          notify("请先在编辑器中选中文本");
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

    this.addCommand({
      id: "export-annotations-to-note",
      name: "导出当前笔记便签为笔记",
      callback: () => app.exportAnnotationsToNote(),
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

  dismissSelectionToolbarForChat(): void {
    this.selectionToolbarSuppressedUntil = Date.now() + 1500;
    this.selectionToolbarEl?.remove();
    this.selectionToolbarEl = null;
  }

  private registerSelectionToolbar(): void {
    const scheduleUpdate = () => window.setTimeout(() => this.updateSelectionToolbar(), 0);
    const scheduleSelectionUpdate = () => {
      window.setTimeout(() => this.updateSelectionToolbar(), 80);
      window.setTimeout(() => this.updateSelectionToolbar(), 180);
    };
    this.registerDomEvent(document, "mouseup", scheduleUpdate);
    this.registerDomEvent(document, "pointerup", scheduleUpdate);
    this.registerDomEvent(document, "selectionchange", scheduleSelectionUpdate);
    this.registerDomEvent(document, "keyup", (evt: KeyboardEvent) => {
      if (evt.key === "Escape") {
        this.closeSelectionToolbar();
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
      if (target instanceof HTMLElement && target.closest(".aio-chat")) {
        this.dismissSelectionToolbarForChat();
        this.hideTranslationPopup();
        return;
      }
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
    if (active instanceof HTMLElement && this.translationPopupEl?.contains(active)) {
      // 焦点在便签/翻译弹窗内时，不展示选中工具栏
      this.selectionToolbarEl?.removeClass("is-visible");
      return;
    }
    if (active instanceof HTMLElement && this.selectionToolbarEl?.contains(active)) {
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

    const snapshot = this.readActiveSelectionSnapshot(mdView);
    if (!snapshot) {
      this.hideSelectionToolbar();
      return;
    }

    // 手动关闭后，同一个选区不再自动弹出
    const signature = selectionSignature(file.path, snapshot.from, snapshot.to, snapshot.text);
    if (this.selectionToolbarClosedSignature === signature) {
      this.selectionToolbarEl?.removeClass("is-visible");
      return;
    }
    this.selectionToolbarClosedSignature = null;

    this.selectionSnapshot = snapshot;

    const toolbar = this.ensureSelectionToolbar();
    toolbar.addClass("is-visible");
    this.positionSelectionToolbar(toolbar);
  }

  private readActiveSelectionSnapshot(mdView: MarkdownView): AIOSelectionSnapshot | null {
    const file = mdView.file;
    if (!(file instanceof TFile) || !mdView.editor) return null;

    const editorText = mdView.editor.getSelection().trim();
    if (editorText) {
      return {
        text: editorText,
        filePath: file.path,
        from: mdView.editor.getCursor("from"),
        to: mdView.editor.getCursor("to"),
        createdAt: Date.now(),
      };
    }

    const domText = this.activeDomSelectionText();
    if (!domText) return null;
    const cursor = mdView.editor.getCursor();
    return {
      text: domText,
      filePath: file.path,
      from: cursor,
      to: cursor,
      createdAt: Date.now(),
    };
  }

  private activeDomSelectionText(): string {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
    const text = selection.toString().trim();
    if (!text) return "";
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if ((anchor && this.selectionToolbarEl?.contains(anchor)) || (focus && this.selectionToolbarEl?.contains(focus))) return "";
    if ((anchor && this.translationPopupEl?.contains(anchor)) || (focus && this.translationPopupEl?.contains(focus))) return "";
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView) return "";
    const inActiveView = (node: Node | null) => !!node && mdView.contentEl.contains(node);
    return inActiveView(anchor) || inActiveView(focus) ? text : "";
  }

  private ensureSelectionToolbar(): HTMLElement {
    if (this.selectionToolbarEl) return this.selectionToolbarEl;

    const toolbar = document.body.createDiv({ cls: "aio-selection-toolbar" });
    const aiRow = toolbar.createDiv({ cls: "aio-selection-row aio-selection-ai-row" });
    const formatRow = toolbar.createDiv({ cls: "aio-selection-row aio-selection-format-row" });
    aiRow.createSpan({ cls: "aio-selection-origin", text: "选中文字" });
    toolbar.addEventListener("pointerdown", (evt) => {
      const target = evt.target;
      if (target instanceof HTMLElement && target.closest(".aio-selection-close")) return;
      if (target instanceof HTMLElement && target.closest(".aio-selection-lang")) return;
      evt.preventDefault();
    });

    const langSelect = this.createSelectionLanguageSelect(aiRow);
    this.createSelectionAction(aiRow, "翻译", "languages", "翻译选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) void this.translateText(snapshot.text, snapshot, langSelect.value || this.settings.translate.defaultTarget);
    });
    this.createSelectionAction(aiRow, "解释", "book-open", "解释选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) void this.askSelectionInChat(snapshot);
    });
    this.createSelectionAction(aiRow, "润色", "wand-2", "润色选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.openSelectionEditModal(snapshot, "polish");
    });
    this.createSelectionAction(aiRow, "扩写", "expand", "扩写选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.openSelectionEditModal(snapshot, "expand");
    });
    this.createSelectionAction(aiRow, "总结", "list", "总结选中文本", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.openSelectionEditModal(snapshot, "summarize");
    });
    this.createSelectionAction(aiRow, "便签", "sticky-note", "给选中文本插入自己的想法", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) this.showThoughtNotePopup(snapshot);
    });
    this.createSelectionAction(aiRow, "询问", "message-square", "把选中文本放入对话上下文", () => {
      const snapshot = this.getSelectionSnapshot();
      this.hideSelectionToolbar();
      if (snapshot) void this.focusSelectionInChat(snapshot);
    });
    const closeBtn = aiRow.createEl("button", {
      cls: "aio-selection-close",
      attr: { type: "button", title: "关闭", "aria-label": "关闭选中文本工具栏" },
    });
    closeBtn.setText("×");
    const close = (evt: Event) => this.closeSelectionToolbar(evt);
    closeBtn.addEventListener("pointerdown", close, { capture: true });
    closeBtn.addEventListener("mousedown", close, { capture: true });
    closeBtn.addEventListener("click", close, { capture: true });

    this.createFormatButton(formatRow, "undo-2", "撤销", () => this.runEditorCommand((editor) => editor.undo()));
    this.createFormatButton(formatRow, "redo-2", "重做", () => this.runEditorCommand((editor) => editor.redo()));
    this.createFormatButton(formatRow, "H2", "二级标题", () => this.toggleHeadingSelection(2));
    this.createFormatButton(formatRow, "H3", "三级标题", () => this.toggleHeadingSelection(3));
    this.createFormatButton(formatRow, "type", "正文", () => this.toggleHeadingSelection(0));
    this.createFormatButton(formatRow, "bold", "加粗", () => this.toggleWrappedSelection("**", "**"));
    this.createFormatButton(formatRow, "italic", "斜体", () => this.toggleWrappedSelection("*", "*"));
    this.createFormatButton(formatRow, "strikethrough", "删除线", () => this.toggleWrappedSelection("~~", "~~"));
    this.createFormatButton(formatRow, "underline", "下划线", () => this.toggleWrappedSelection("<u>", "</u>"));
    this.createFormatButton(formatRow, "code-2", "行内代码", () => this.toggleWrappedSelection("`", "`"));
    this.createFormatButton(formatRow, "highlighter", "荧光笔", () => this.toggleWrappedSelection("==", "=="));
    this.createFormatButton(formatRow, "link", "链接", () => this.toggleWrappedSelection("[", "](url)"));
    this.createFormatButton(formatRow, "table-2", "表格", () => this.insertAfterSelection("\n\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n"));
    this.createColorButton(formatRow, "#b42318", "红色文字", (text) => this.toggleColorMarkup(text, "color", "#b42318"), "text");
    this.createColorButton(formatRow, "#08796f", "绿色文字", (text) => this.toggleColorMarkup(text, "color", "#08796f"), "text");
    this.createColorButton(formatRow, "#2563eb", "蓝色文字", (text) => this.toggleColorMarkup(text, "color", "#2563eb"), "text");
    this.createColorButton(formatRow, "#fff1a8", "黄色高亮", (text) => this.toggleColorMarkup(text, "background", "#fff1a8"), "mark");
    this.createFormatButton(formatRow, "eraser", "清除简单格式", () => this.clearBasicFormat());

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
    btn.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    btn.addEventListener("click", onClick);
  }

  private createFormatButton(
    toolbar: HTMLElement,
    iconOrText: string,
    title: string,
    onClick: () => void
  ): void {
    const btn = toolbar.createEl("button", {
      cls: "aio-format-btn",
      attr: { type: "button", title, "aria-label": title },
    });
    if (/^H\d$/.test(iconOrText)) {
      btn.createSpan({ cls: "aio-format-text", text: iconOrText });
    } else {
      setIcon(btn.createSpan({ cls: "aio-format-icon" }), iconOrText);
    }
    btn.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    btn.addEventListener("click", () => {
      onClick();
      this.selectionToolbarSuppressedUntil = Date.now() + 900;
    });
  }

  private createColorButton(
    toolbar: HTMLElement,
    color: string,
    title: string,
    transform: (text: string) => string,
    type: "text" | "mark"
  ): void {
    const btn = toolbar.createEl("button", {
      cls: `aio-format-btn aio-color-btn is-${type}`,
      attr: { type: "button", title, "aria-label": title },
    });
    btn.style.setProperty("--aio-swatch", color);
    btn.createSpan({ cls: "aio-color-swatch" });
    btn.addEventListener("pointerdown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    btn.addEventListener("click", () => this.transformSnapshotSelection(transform));
  }

  private runEditorCommand(action: (editor: Editor) => void): void {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView?.editor) return;
    action(mdView.editor);
    this.hideSelectionToolbar();
  }

  private toggleWrappedSelection(before: string, after: string): void {
    this.transformSnapshotSelection((text) => {
      if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
        return text.slice(before.length, text.length - after.length);
      }
      return `${before}${text}${after}`;
    });
  }

  private insertAfterSelection(text: string): void {
    const snapshot = this.getSelectionSnapshot();
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!snapshot || !mdView?.editor || mdView.file?.path !== snapshot.filePath) return;
    if (samePosition(snapshot.from, snapshot.to)) {
      mdView.editor.replaceRange(text, mdView.editor.getCursor());
    } else {
      mdView.editor.replaceRange(`${snapshot.text}${text}`, snapshot.from, snapshot.to);
    }
    this.hideSelectionToolbar();
  }

  private transformSnapshotSelection(transform: (text: string) => string): void {
    const snapshot = this.getSelectionSnapshot();
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!snapshot || !mdView?.editor || mdView.file?.path !== snapshot.filePath || samePosition(snapshot.from, snapshot.to)) {
      notify("当前选区不可写入，请切换至编辑模式");
      return;
    }
    this.applyReplacement(mdView.editor, snapshot.from, snapshot.to, transform(snapshot.text), "已应用格式");
    this.hideSelectionToolbar();
  }

  private toggleHeadingSelection(level: 0 | 2 | 3): void {
    const snapshot = this.getSelectionSnapshot();
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!snapshot || !mdView?.editor || mdView.file?.path !== snapshot.filePath || samePosition(snapshot.from, snapshot.to)) {
      notify("当前选区不可写入，请切换至编辑模式");
      return;
    }
    const prefix = level === 0 ? "" : `${"#".repeat(level)} `;
    const formatted = snapshot.text
      .split("\n")
      .map((line) => {
        const withoutHeading = line.replace(/^#{1,6}\s+/, "");
        const hasSameHeading = level > 0 && line.startsWith(prefix);
        return level === 0 || hasSameHeading ? withoutHeading : `${prefix}${withoutHeading}`;
      })
      .join("\n");
    this.applyReplacement(mdView.editor, snapshot.from, snapshot.to, formatted, "已应用标题格式");
    this.hideSelectionToolbar();
  }

  private toggleColorMarkup(text: string, prop: "color" | "background", value: string): string {
    const escapedProp = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tagRe = new RegExp(`^<(span|mark)\\s+style="${escapedProp}:${escapedValue}">([\\s\\S]*)<\\/\\1>$`);
    const matched = text.match(tagRe);
    if (matched) return matched[2];
    const tag = prop === "background" ? "mark" : "span";
    return `<${tag} style="${prop}:${value}">${text}</${tag}>`;
  }

  private clearBasicFormat(): void {
    this.transformSnapshotSelection((text) =>
      text
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/~~([^~]+)~~/g, "$1")
        .replace(/==([^=]+)==/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/<\/?u>/g, "")
        .replace(/<\/?(span|mark)\b[^>]*>/g, "")
    );
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
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  private hideSelectionToolbar(): void {
    this.selectionToolbarSuppressedUntil = Date.now() + 350;
    this.selectionToolbarEl?.removeClass("is-visible");
  }

  /** 手动关闭工具栏：记录当前选区，直到选区变化前不再自动弹出 */
  private closeSelectionToolbar(evt?: Event): void {
    evt?.preventDefault();
    evt?.stopPropagation();
    (evt as any)?.stopImmediatePropagation?.();
    this.selectionToolbarSuppressedUntil = Date.now() + 10000;
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView?.editor) {
      const from = mdView.editor.getCursor("from");
      const to = mdView.editor.getCursor("to");
      const text = mdView.editor.getSelection();
      this.selectionToolbarClosedSignature = selectionSignature(
        mdView.file?.path ?? "",
        from,
        to,
        text
      );
      mdView.editor.setCursor(to);
    }
    window.getSelection()?.removeAllRanges();
    this.selectionSnapshot = null;
    this.selectionToolbarEl?.remove();
    this.selectionToolbarEl = null;
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
    if (!mdView?.editor || mdView.file?.path !== snapshot.filePath || samePosition(snapshot.from, snapshot.to)) {
      await navigator.clipboard.writeText(result);
      notify("选区无法替换，结果已复制到剪贴板");
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
    // 高亮期间不让选中工具栏弹出，避免“关不掉”的感觉
    this.selectionToolbarSuppressedUntil = Date.now() + 1800;
    this.showEditUndoPill(editor, from, newTo);
    notifySuccess(`${label}（可撤回）`);
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

  // ---------------- 浏览位置记忆 ----------------

  /** 记录当前笔记的滚动位置与光标行（滚动/输入时调用），并防抖持久化 */
  private savePosition(file: TFile, editor: Editor): void {
    try {
      const info = editor.getScrollInfo();
      const cursor = editor.getCursor();
      const pos = { top: info.top, line: cursor.line, ch: cursor.ch };
      this.notePositions.set(file.path, pos);
      // 同步到 settings（防抖写盘），实现跨重启恢复；delete+set 把最近访问排到末尾
      const positions = this.settings.scrollRestore.positions;
      if (positions[file.path]) delete positions[file.path];
      positions[file.path] = pos;
      this.scheduleScrollPositionSave();
    } catch {
      /* ignore */
    }
  }

  /** 防抖把浏览位置写盘（滚动很频繁，不能每次都 saveSettings） */
  private scheduleScrollPositionSave(): void {
    if (this.scrollSaveTimer) window.clearTimeout(this.scrollSaveTimer);
    this.scrollSaveTimer = window.setTimeout(() => {
      this.scrollSaveTimer = null;
      this.settings.scrollRestore.positions = capScrollPositions(
        this.settings.scrollRestore.positions,
        1000
      );
      void this.saveSettings();
    }, 800);
  }

  /** 把滚动监听器挂到当前笔记的编辑器滚动容器上 */
  private attachScrollListener(): void {
    if (this.scrollEl && this.scrollHandler) {
      this.scrollEl.removeEventListener("scroll", this.scrollHandler);
    }
    this.scrollEl = null;
    this.scrollHandler = null;
    if (this.annotationPruneTimer) {
      window.clearTimeout(this.annotationPruneTimer);
      this.annotationPruneTimer = null;
    }

    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView || !(mdView.file instanceof TFile)) return;
    const file = mdView.file;
    const editor = mdView.editor;
    if (!editor) return;
    const scroller = mdView.contentEl.querySelector<HTMLElement>(".cm-scroller");
    if (!scroller) return;
    this.scrollEl = scroller;
    this.scrollHandler = () => {
      if (this.settings.scrollRestore.enabled) {
        this.savePosition(file, editor);
      }
    };
    scroller.addEventListener("scroll", this.scrollHandler, { passive: true });
  }

  /** 打开笔记时恢复到上次的滚动位置与光标行 */
  private restoreScrollFor(file: TFile, force = false): boolean {
    if (!force && !this.settings.scrollRestore.enabled) return false;
    const saved = this.notePositions.get(file.path);
    if (!saved) return false;
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdView || mdView.file?.path !== file.path || !mdView.editor) return false;
    const editor = mdView.editor;
    try {
      if (typeof saved.line === "number") {
        editor.setCursor({ line: saved.line, ch: saved.ch ?? 0 });
      }
      if (typeof saved.top === "number") {
        // 先恢复光标，再强制滚动到上次位置（滚动优先）
        editor.scrollTo(null, saved.top);
      }
      return true;
    } catch {
      return false;
    }
  }

  private restoreCurrentScrollPosition(showNotice = false): void {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      if (showNotice) notify("请先打开 Markdown 笔记");
      return;
    }
    const persisted = this.settings.scrollRestore.positions?.[file.path];
    if (persisted && !this.notePositions.has(file.path)) {
      this.notePositions.set(file.path, persisted);
    }
    if (!this.notePositions.has(file.path)) {
      if (showNotice) notify("该笔记暂无浏览位置记录");
      return;
    }
    const apply = () => this.restoreScrollFor(file, true);
    const restored = apply();
    requestAnimationFrame(apply);
    window.setTimeout(apply, 350);
    if (showNotice) {
      notify(restored ? "已恢复上次浏览位置" : "无法恢复上次浏览位置", {
        type: restored ? "success" : "error",
      });
    }
  }

  /** 注册：切换笔记时记录位置，打开笔记时恢复位置 */
  private registerScrollRestore(): void {
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.attachScrollListener();
        if (file instanceof TFile) {
          this.scheduleAnnotationPrune(file);
        }
        if (!(file instanceof TFile) || !this.settings.scrollRestore.enabled) return;
        if (!this.notePositions.has(file.path)) return;
        const apply = () => this.restoreScrollFor(file);
        let notified = false;
        const applyWithNotice = () => {
          if (apply() && !notified) {
            notified = true;
            notifySuccess("已恢复上次浏览位置");
          }
        };
        requestAnimationFrame(applyWithNotice);
        window.setTimeout(apply, 350); // 图片/字体加载完成后二次校正
      })
    );

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.attachScrollListener()));

    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mdView || mdView.editor !== editor || !(mdView.file instanceof TFile)) return;
        if (this.settings.scrollRestore.enabled) {
          this.savePosition(mdView.file, editor);
        }
        // 文本被修改后，自动清理引用已失效的便签
        this.scheduleAnnotationPrune(mdView.file);
      })
    );

    this.attachScrollListener();
  }

  openSettings(): void {
    const setting = (this.app as any).setting;
    if (!setting) {
      notify("请在 Obsidian 设置 → 第三方插件中打开 AI Organizer 配置");
      return;
    }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  async formatNote(): Promise<void> {
    if (this.formattingInProgress) {
      notify("排版中…");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      notify("请先打开 Markdown 笔记");
      return;
    }
    const mode = this.settings.formatting.mode;
    this.formattingInProgress = true;
    const loadingNotice = notifyLoading("正在排版…");

    try {
      loadingNotice.setMessage("正在排版（保护图片与附件引用）…");
      const result = await this.formatting.formatActiveNote(mode);
      if (!result) return;
      const { file: resultFile, before, after } = result;

      loadingNotice.setMessage("排版完成，打开预览中…");
      const apply = async () => {
        await this.app.vault.modify(resultFile, after);
        notifySuccess(`已排版：${resultFile.basename}`);
      };

      if (this.settings.formatting.previewBeforeApply) {
        new FormattingPreviewModal(this.app, resultFile, before, after, apply).open();
      } else {
        await apply();
      }
    } catch (err: any) {
      notifyError(`排版失败：${err?.message || err}`, 8000);
    } finally {
      loadingNotice.hide();
      this.formattingInProgress = false;
    }
  }

  async organizeImages(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      notify("请先打开 Markdown 笔记");
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
    const loading = notifyLoading("正在扫描未引用附件…");
    const orphans = await this.imageOrganizer.findOrphans();
    loading.hide();
    if (orphans.length === 0) {
      notifySuccess("未发现未引用的附件");
      return;
    }
    new OrphanModal(this.app, orphans, async (files) => {
      const moved = await this.imageOrganizer.moveOrphansToTrash(files);
      notifySuccess(`已移动 ${moved} 个附件至「未引用附件」`);
    }).open();
  }

  async generateMetadata(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      notify("请先打开 Markdown 笔记");
      return;
    }
    const loading = notifyLoading("正在生成元数据…");
    await this.metadataGenerator.applyToNote(file);
    loading.hide();
  }

  async organizeInbox(): Promise<void> {
    const notes = this.inboxOrganizer.listInboxNotes();
    if (notes.length === 0) {
      notify(`收件箱「${this.settings.inbox.inboxFolder}」暂无笔记`);
      return;
    }
    const loading = notifyLoading(`正在分析 ${notes.length} 篇收件箱笔记…`);
    try {
      const suggestions = await this.inboxOrganizer.suggestMoves(notes);
      loading.hide();
      new InboxConfirmModal(this.app, suggestions, async (moves) => {
        const { moved, kept } = await this.inboxOrganizer.executeMoves(moves);
        notifySuccess(`整理完成：移动 ${moved} 篇，保留 ${kept} 篇`);
      }).open();
    } catch (err: any) {
      loading.hide();
      notifyError(`整理失败：${err?.message || err}`, 6000);
    }
  }

  async suggestLinks(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      notify("请先打开 Markdown 笔记");
      return;
    }
    const loading = notifyLoading("正在分析相关笔记…");
    try {
      const suggestions = await this.linkSuggester.suggest(file);
      loading.hide();
      new LinkSuggestModal(this.app, suggestions, async (selected) => {
        await this.linkSuggester.appendLinks(file, selected);
      }).open();
    } catch (err: any) {
      loading.hide();
      notifyError(`分析失败：${err?.message || err}`, 6000);
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
    const loading = notifyLoading("批量处理中 0/" + total);
    const results = await this.batchProcessor.process(files, op, (done) => {
      loading.setMessage(`批量处理中 ${done}/${total}`);
    });
    loading.hide();
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      const detail = failed.map((r) => `${r.file.name}: ${r.message}`).slice(0, 10).join("\n");
      notifyError(`失败 ${failed.length} 篇：\n${detail}`, 10000);
    } else {
      notifySuccess(`批量处理完成：${results.length} 篇`);
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
        placeholder: "例：与上一节概念相关，需再查原文…",
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
      notifySuccess("翻译内容已复制");
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
        text: isEditing ? "正在修改该文本的便签" : "该文本已有翻译便签",
      });
      existing.createDiv({
        cls: "aio-annotation-existing-item",
        text: "保存将更新原便签，不新增。",
      });
    }

    const thoughtWrap = popup.createDiv({ cls: "aio-translation-thought" });
    thoughtWrap.createDiv({ cls: "aio-translation-thought-label", text: "自己的想法" });
    const thoughtEl = thoughtWrap.createEl("textarea", {
      cls: "aio-translation-thought-input",
      attr: {
        rows: "5",
        placeholder: "输入批注、疑问或待办…",
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
    notifySuccess("翻译便签已保存");
  }

  private async insertThoughtNote(thought: string, snapshot: AIOSelectionSnapshot): Promise<void> {
    const cleanedThought = thought.trim();
    if (!cleanedThought) {
      notify("请输入想法内容");
      return;
    }
    await this.saveAnnotation({
      snapshot,
      type: "thought",
      thought: cleanedThought,
    });
    notifySuccess("便签已保存");
  }

  private async saveAnnotation(opts: {
    snapshot: AIOSelectionSnapshot;
    type: "translation" | "thought";
    translated?: string;
    thought?: string;
    targetLang?: string;
  }): Promise<void> {
    const quote = this.stripOrganizerInlineNotes(opts.snapshot.text).trim() || opts.snapshot.text.trim();
    // Zotero 式锚点：记录 quote 位置，定位时优先锚点、文字兜底
    const anchor = computeQuoteAnchor(opts.snapshot.from, opts.snapshot.text, quote);
    let existing = this.findAnnotationForSelection(opts.snapshot.filePath, opts.type, quote);
    const now = Date.now();
    if (existing) {
      existing.quote = quote;
      existing.anchorFrom = anchor?.from;
      existing.anchorTo = anchor?.to;
      existing.anchorLost = false;
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
        anchorFrom: anchor?.from,
        anchorTo: anchor?.to,
        anchorLost: false,
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
    const byRange = new Map<
      string,
      { from: number; to: number; annotations: AIOAnnotation[]; lost?: boolean }
    >();

    for (const annotation of annotations) {
      const quote = annotation.quote.trim();
      // 优先按锚点定位（Zotero 式），找不到再全文搜索
      const primary = resolveQuoteRange(doc, annotation);
      let from = primary ? primary.from : doc.indexOf(quote);
      if (from === -1) {
        // 引文已被破坏：匹配剩余的最长片段，用「失效」样式标出来，而不是整条消失
        if (quote.length <= 300) {
          const partial = findBestPartialMatch(doc, quote);
          if (partial) {
            const key = `${partial.from}:${partial.to}`;
            const existing = byRange.get(key);
            if (existing) {
              existing.annotations.push(annotation);
              existing.lost = true;
            } else {
              byRange.set(key, {
                from: partial.from,
                to: partial.to,
                annotations: [annotation],
                lost: true,
              });
            }
          }
        }
        continue;
      }
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
        value: Decoration.mark({
          class: range.lost ? "aio-annotation-highlight is-lost" : "aio-annotation-highlight",
        }),
      });
      // 标记放在引文起点、side:-1，避免遮挡行尾光标
      decorations.push({
        from: range.from,
        to: range.from,
        value: Decoration.widget({
          widget: new AnnotationMarkerWidget(this, range.annotations, range.lost),
          side: -1,
        }),
      });
    }

    return Decoration.set(decorations, true);
  }

  private refreshAnnotationDecorations(): void {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const cm = (mdView?.editor as unknown as { cm?: EditorView }).cm;
    if (!cm) return;
    // 输入法组合输入期间不派发刷新，避免打断组合、弄丢光标（文档变化本身也会触发装饰重建）
    if (cm.composing) return;
    cm.dispatch({ effects: annotationRefreshEffect.of() });
    window.requestAnimationFrame(() => {
      if (!cm.composing) {
        cm.dispatch({ effects: annotationRefreshEffect.of() });
      }
    });
  }

  /** 文本变化后核对便签引文是否仍在文档中：找不到时标记「位置失效」而不是删除（符合主流产品做法） */
  private async pruneMissingAnnotations(file: TFile, contentOverride?: string): Promise<boolean> {
    const content = contentOverride ?? (await this.app.vault.cachedRead(file));
    let changed = false;
    for (const item of this.settings.annotations) {
      if (item.filePath !== file.path) continue;
      if (item.quote.trim().length <= 1) continue;
      const found = content.includes(item.quote.trim());
      if (!found && !item.anchorLost) {
        item.anchorLost = true;
        changed = true;
      } else if (found && item.anchorLost) {
        item.anchorLost = false;
        changed = true;
      }
    }
    if (!changed) return false;
    await this.saveSettings();
    this.refreshAnnotationDecorations();
    return true;
  }

  /** 文本变化后延迟清理失效的便签（引文被修改/删除时自动移除） */
  private scheduleAnnotationPrune(file: TFile): void {
    if (!this.settings.annotations.some((item) => item.filePath === file.path)) return;
    if (this.annotationPruneTimer) window.clearTimeout(this.annotationPruneTimer);
    this.annotationPruneTimer = window.setTimeout(() => {
      this.annotationPruneTimer = null;
      const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (mdView?.file?.path !== file.path || !mdView.editor) return;
      const cm = (mdView.editor as unknown as { cm?: { composing?: boolean } }).cm;
      if (cm?.composing) {
        // 输入法组合中不清理，避免打断输入；稍后重试
        this.scheduleAnnotationPrune(file);
        return;
      }
      void this.pruneMissingAnnotations(file, mdView.editor.getValue());
    }, 600);
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
      notify("该文本暂无便签");
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

    if (annotations.some((item) => item.anchorLost)) {
      const lostHint = popup.createDiv({ cls: "aio-annotation-existing" });
      lostHint.createDiv({
        cls: "aio-annotation-existing-title",
        text: "⚠️ 原文已变，这条便签无法定位到正文（可在面板中删除）",
      });
    }

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
        placeholder: "输入或修改理解、疑问、关联线索…",
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
        notifySuccess("已删除想法便签");
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
        notify("请输入想法内容");
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
      notify("请先打开 Markdown 笔记");
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
    const exportBtn = head.createEl("button", {
      cls: "aio-translation-icon-btn",
      attr: { type: "button", title: "导出便签为笔记", "aria-label": "导出便签为笔记" },
    });
    setIcon(exportBtn.createSpan({ cls: "aio-translation-icon" }), "download");
    exportBtn.addEventListener("click", () => {
      void this.exportAnnotationsToNote();
    });
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
      text: this.panelSummaryText(annotations),
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
      if (item.anchorLost) {
        meta.createSpan({ cls: "aio-annotation-kind is-lost", text: "位置已失效" });
      }
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
      const openAction = () =>
        item.anchorLost
          ? this.showAnnotationThread(item.filePath, item.quote)
          : this.jumpToAnnotation(item);
      row.addEventListener("click", openAction);
      row.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          openAction();
        }
      });
    }

    this.positionFloatingPanel(popup);
  }

  /** 点击便签跳转到原文位置（Zotero 式导航） */
  jumpToAnnotation(item: AIOAnnotation): void {
    const file = this.app.vault.getAbstractFileByPath(item.filePath);
    if (!(file instanceof TFile)) {
      notifyError("便签所属笔记不存在");
      return;
    }
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView?.file?.path === file.path) {
      this.selectQuoteInEditor(mdView.editor, item);
      return;
    }
    void this.app.workspace.getLeaf(false).openFile(file).then(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.file?.path === file.path) {
        this.selectQuoteInEditor(view.editor, item);
      }
    });
  }

  /** 选中并滚动到便签引文 */
  private selectQuoteInEditor(editor: Editor, item: AIOAnnotation): void {
    const doc = editor.getValue();
    const range = resolveQuoteRange(doc, item);
    if (!range) {
      notifyError("该文本在当前笔记中不存在");
      return;
    }
    const from = posFromOffset(doc, range.from);
    const to = posFromOffset(doc, range.to);
    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);
    this.selectionToolbarSuppressedUntil = Date.now() + 1200;
  }

  /** 把当前笔记的全部便签导出为一篇 Markdown 笔记（对应 Zotero 的「合并为笔记」） */
  async exportAnnotationsToNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      notify("请先打开 Markdown 笔记");
      return;
    }
    await this.pruneMissingAnnotations(file);
    const annotations = this.uniqueAnnotations(
      this.settings.annotations.filter((item) => item.filePath === file.path)
    ).sort((a, b) => b.updatedAt - a.updatedAt);
    if (annotations.length === 0) {
      notify("该笔记暂无便签");
      return;
    }

    const lines: string[] = [];
    lines.push(`# ${file.basename} · 便签汇总`);
    lines.push("");
    lines.push(`> [!quote] 由 AI Organizer 导出 · ${new Date().toLocaleString()}`);
    lines.push("");
    for (const item of annotations) {
      lines.push(`## ${item.type === "translation" ? `翻译${item.targetLang ? `（${item.targetLang}）` : ""}` : "想法"}${item.anchorLost ? "（位置已失效）" : ""}`);
      lines.push("");
      if (item.anchorLost) {
        lines.push("> [!warning] 原文已变，无法定位到正文");
        lines.push("");
      }
      lines.push(`> ${item.quote.split("\n").join("\n> ")}`);
      lines.push("");
      if (item.type === "translation" && item.translated) {
        lines.push(`**译文：** ${item.translated}`);
        lines.push("");
      }
      if (item.thought) {
        lines.push(`**我的想法：** ${item.thought}`);
        lines.push("");
      }
      lines.push(`*${new Date(item.updatedAt).toLocaleString()}*`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    const folder = file.parent?.path ?? "";
    const fileName = `${folder ? folder + "/" : ""}${file.basename} 便签.md`;
    const newFile = await this.app.vault.create(fileName, lines.join("\n"));
    notifySuccess(`已导出 ${annotations.length} 条便签`);
    void this.app.workspace.getLeaf(false).openFile(newFile);
  }

  /** 便签面板摘要文本 */
  private panelSummaryText(annotations: AIOAnnotation[]): string {
    const lost = annotations.filter((item) => item.anchorLost).length;
    const suffix = lost > 0 ? `（其中 ${lost} 条位置已失效，点开查看或删除）` : "";
    return `${annotations.length} 条便签 · 点击卡片跳转原文 · 右侧可删除${suffix}`;
  }

  private async deleteAnnotation(id: string, after?: () => void, ask = true, notify = true): Promise<void> {
    const item = this.settings.annotations.find((annotation) => annotation.id === id);
    if (!item) {
      notifyError("便签不存在");
      return;
    }
    if (ask && !confirm("确定删除这条便签吗？")) return;
    this.settings.annotations = this.settings.annotations.filter((annotation) => annotation.id !== id);
    await this.saveSettings();
    this.refreshAnnotationDecorations();
    if (notify) notifySuccess("已删除便签");
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
