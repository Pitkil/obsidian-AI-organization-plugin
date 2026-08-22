import {
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  setIcon,
} from "obsidian";
import * as Tesseract from "tesseract.js";
import type AIOrganizerPlugin from "../main";
import type { ChatImagePart, ChatMessage, ModelProvider } from "../types";
import { timestamp } from "../utils";

export const CHAT_VIEW_TYPE = "ai-organizer-chat-view";
const CONFIGURE_TEXT_MODEL_VALUE = "__configure_text_model__";
const CONTEXT_CHAR_BUDGET = 16000;

function shortProviderLabel(providerId: string): string {
  if (providerId === "openaiCompatible") return "OpenAI";
  if (providerId === "anthropic") return "Claude";
  return "Gemini";
}

// ============================================================
// AI 对话侧边栏面板
// ============================================================

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private messageContainer!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLElement;
  private stopBtn!: HTMLElement;
  private modelSelect!: HTMLSelectElement;
  private noteToggle!: HTMLInputElement;
  private selToggle!: HTMLInputElement;
  private contextBar!: HTMLElement;
  private contextChip!: HTMLElement;
  private contextChipText!: HTMLElement;
  private contextClearBtn!: HTMLElement;
  private contextMeter!: HTMLElement;
  private contextMeterValue!: HTMLElement;
  private controlsEl!: HTMLElement;
  private workbenchToggleBtn!: HTMLElement;
  private modelPicker!: HTMLElement;
  private typingEl: HTMLElement | null = null;
  private abortCtrl: AbortController | null = null;
  private streaming = false;
  private emptyState: HTMLElement | null = null;
  private workbenchCollapsed = false;
  private selectionSnapshotText = "";
  private selectionSnapshotFilePath = "";

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: AIOrganizerPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "笔记助手";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.buildUi();
    // 监听笔记切换，更新注入的上下文提示
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.refreshContextHints())
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => this.refreshContextHints())
    );
    this.registerDomEvent(document, "selectionchange", () => this.refreshInputContext());
  }

  async onClose(): Promise<void> {
    this.abortCtrl?.abort();
  }

  // ---------------- UI 构建 ----------------

  private buildUi(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("aio-chat");

    // ---- 头部 ----
    const header = root.createDiv({ cls: "aio-chat-header" });
    const titleRow = header.createDiv({ cls: "aio-chat-header-title" });
    const mark = titleRow.createSpan({ cls: "aio-chat-logo" });
    setIcon(mark, "message-square");
    const titleBlock = titleRow.createDiv({ cls: "aio-chat-title-block" });
    titleBlock.createSpan({ cls: "aio-chat-title", text: "笔记助手" });
    titleBlock.createSpan({ cls: "aio-chat-subtitle", text: "上下文对话" });

    // ---- 操作按钮 ----
    const actions = header.createDiv({ cls: "aio-chat-actions" });
    this.workbenchToggleBtn = actions.createEl("button", { cls: "aio-icon-btn", attr: { "aria-label": "展开工具", title: "展开工具" } });
    setIcon(this.workbenchToggleBtn, "chevron-down");
    this.workbenchToggleBtn.addEventListener("click", () => this.toggleWorkbench());
    const settingsBtn = actions.createEl("button", { cls: "aio-icon-btn", attr: { "aria-label": "打开设置", title: "设置" } });
    setIcon(settingsBtn, "settings-2");
    settingsBtn.addEventListener("click", () => this.plugin.openSettings());
    const closeBtn = actions.createEl("button", { cls: "aio-icon-btn aio-chat-close-btn", attr: { "aria-label": "关闭侧边栏", title: "关闭侧边栏" } });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => void this.plugin.closeChatView());

    const controls = root.createDiv({ cls: "aio-chat-controls" });
    this.controlsEl = controls;
    this.workbenchCollapsed = true;
    this.controlsEl.addClass("is-collapsed");

    const workbenchHead = controls.createDiv({ cls: "aio-workbench-head" });
    workbenchHead.createDiv({ cls: "aio-workbench-title", text: "对话工作台" });
    workbenchHead.createDiv({ cls: "aio-workbench-desc", text: "处理当前笔记、附件与侧栏对话；文本内选中会出现独立浮层。" });

    // ---- 上下文开关 ----
    const ctxRow = controls.createDiv({ cls: "aio-chat-ctx" });
    this.noteToggle = this.createToggle(ctxRow, "当前笔记", this.plugin.settings.chat.injectCurrentNote);
    this.selToggle = this.createToggle(ctxRow, "选中文本", this.plugin.settings.chat.injectSelection);
    ctxRow.createSpan({ cls: "aio-chat-ctx-note" });

    const tools = controls.createDiv({ cls: "aio-chat-tools" });
    this.createToolButton(tools, "排版", "pilcrow", () => void this.plugin.formatNote());
    this.createToolButton(tools, "便签", "sticky-note", () => this.plugin.openAnnotationPanel());
    this.createToolButton(tools, "元数据", "tags", () => void this.plugin.generateMetadata());
    this.createToolButton(tools, "双链", "link-2", () => void this.plugin.suggestLinks());
    this.createToolButton(tools, "图片", "image", () => void this.plugin.organizeImages());
    this.createToolButton(tools, "收件箱", "inbox", () => void this.plugin.organizeInbox());

    const panelActions = controls.createDiv({ cls: "aio-chat-panel-actions" });
    const saveBtn = panelActions.createEl("button", { cls: "aio-icon-btn", attr: { "aria-label": "保存对话为笔记", title: "保存对话" } });
    setIcon(saveBtn, "save");
    saveBtn.addEventListener("click", () => this.saveConversation());
    const clearBtn = panelActions.createEl("button", { cls: "aio-icon-btn", attr: { "aria-label": "清空对话", title: "清空" } });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => this.clearConversation());

    // ---- 消息区 ----
    this.messageContainer = root.createDiv({ cls: "aio-chat-messages" });
    this.messageContainer.empty();

    // ---- 输入区 ----
    const inputArea = root.createDiv({ cls: "aio-chat-input-area" });
    this.contextBar = inputArea.createDiv({ cls: "aio-input-context" });
    this.contextChip = this.contextBar.createDiv({ cls: "aio-context-chip" });
    this.contextChip.createSpan({ cls: "aio-context-ring" });
    this.contextChipText = this.contextChip.createSpan({ cls: "aio-context-chip-text" });
    this.contextClearBtn = this.contextChip.createEl("button", {
      cls: "aio-context-clear is-hidden",
      attr: { type: "button", title: "移除选中文本上下文", "aria-label": "移除选中文本上下文" },
    });
    setIcon(this.contextClearBtn, "x");
    this.contextClearBtn.addEventListener("click", (evt) => {
      evt.preventDefault();
      this.clearSelectionContext();
    });

    const inputWrap = inputArea.createDiv({ cls: "aio-chat-input-wrap" });
    this.inputEl = inputWrap.createEl("textarea", {
      cls: "aio-chat-input",
      attr: { placeholder: "输入消息，Enter 发送，Shift+Enter 换行…" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.contextMeter = inputArea.createDiv({ cls: "aio-context-meter" });
    this.contextMeterValue = this.contextMeter.createSpan({ cls: "aio-context-meter-value", text: "0%" });

    const inputToolbar = inputArea.createDiv({ cls: "aio-input-toolbar" });
    this.modelPicker = inputToolbar.createDiv({ cls: "aio-model-picker" });
    const modelPicker = this.modelPicker;
    const modelIcon = this.modelPicker.createSpan({ cls: "aio-model-picker-icon" });
    setIcon(modelIcon, "bot");
    this.modelSelect = modelPicker.createEl("select", { cls: "aio-model-select", attr: { "aria-label": "选择模型", title: "选择模型" } });
    this.populateModelSelect();
    this.modelSelect.addEventListener("change", () => this.onModelChange());

    this.sendBtn = inputToolbar.createEl("button", { cls: "aio-send-btn", attr: { "aria-label": "发送" } });
    setIcon(this.sendBtn, "send");
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    this.stopBtn = inputToolbar.createEl("button", { cls: "aio-stop-btn is-hidden", attr: { "aria-label": "停止生成" } });
    setIcon(this.stopBtn, "square");
    this.stopBtn.addEventListener("click", () => this.abortCtrl?.abort());

    this.refreshContextHints();
    this.inputEl.focus();
  }

  askAboutSelection(text: string, filePath?: string): void {
    this.useSelectionContext(text, filePath);
    this.inputEl.value = "讲解这段选中文本";
    void this.sendMessage();
  }

  focusWithSelection(text: string, filePath?: string): void {
    this.useSelectionContext(text, filePath);
    this.inputEl.value = "";
    this.inputEl.setAttr("placeholder", "基于选中文本继续提问…");
    this.inputEl.focus();
  }

  private createToggle(parent: HTMLElement, label: string, checked: boolean): HTMLInputElement {
    const wrap = parent.createDiv({ cls: "aio-toggle" });
    const input = wrap.createEl("input", { type: "checkbox" });
    input.checked = checked;
    const span = wrap.createSpan({ text: label });
    wrap.addEventListener("click", (e) => {
      e.preventDefault();
      input.checked = !input.checked;
      this.setToggleState(input, input.checked);
      this.refreshInputContext();
    });
    this.setToggleState(input, checked);
    return input;
  }

  private setToggleState(input: HTMLInputElement, checked: boolean): void {
    input.checked = checked;
    input.parentElement?.toggleClass("is-on", checked);
    input.parentElement?.querySelector("span")?.toggleClass("is-on", checked);
  }

  private createToolButton(
    parent: HTMLElement,
    label: string,
    icon: string,
    onClick: () => void
  ): void {
    const btn = parent.createEl("button", {
      cls: "aio-tool-btn",
      attr: { title: label, "aria-label": label },
    });
    const iconEl = btn.createSpan({ cls: "aio-tool-btn-icon" });
    setIcon(iconEl, icon);
    btn.createSpan({ cls: "aio-tool-btn-label", text: label });
    btn.addEventListener("click", onClick);
  }

  private toggleWorkbench(): void {
    this.workbenchCollapsed = !this.workbenchCollapsed;
    this.controlsEl.toggleClass("is-collapsed", this.workbenchCollapsed);
    this.workbenchToggleBtn.setAttr("aria-label", this.workbenchCollapsed ? "展开工作台" : "收起工作台");
    this.workbenchToggleBtn.setAttr("title", this.workbenchCollapsed ? "展开工作台" : "收起工作台");
    this.workbenchToggleBtn.empty();
    setIcon(this.workbenchToggleBtn, this.workbenchCollapsed ? "chevron-down" : "chevron-up");
  }

  private populateModelSelect(): void {
    this.modelSelect.empty();
    const profiles = this.plugin.chatService.getConfiguredProfiles("text");
    this.modelPicker.removeClass("is-hidden");
    this.modelPicker.toggleClass("is-empty", profiles.length === 0);
    if (profiles.length === 0) {
      this.modelSelect.createEl("option", {
        value: CONFIGURE_TEXT_MODEL_VALUE,
        text: "配置文本模型",
      });
      this.modelSelect.value = CONFIGURE_TEXT_MODEL_VALUE;
      return;
    }

    for (const profile of profiles) {
      this.modelSelect.createEl("option", {
        value: profile.id,
        text: `${shortProviderLabel(profile.providerId)} · ${profile.name || profile.model}`,
      });
    }

    if (profiles.some((profile) => profile.id === this.plugin.settings.activeTextModelProfileId)) {
      this.modelSelect.value = this.plugin.settings.activeTextModelProfileId;
    } else {
      this.modelSelect.value = profiles[0].id;
    }
    return;

    const providers = this.plugin.chatService.getProviders();
    const available = providers.filter((p) => p.isConfigured());
    if (available.length === 0) {
      const opt = this.modelSelect.createEl("option", { value: "", text: "先配置模型" });
      opt.disabled = true;
      opt.selected = true;
    }
    for (const p of providers) {
      const models = this.modelsForProvider(p.id);
      for (const model of models) {
        const opt = this.modelSelect.createEl("option", {
          value: `${p.id}::${model}`,
          text: `${shortProviderLabel(p.id)} · ${model}`,
        });
        opt.disabled = !p.isConfigured();
      }
    }
    // 选中当前激活提供商
    const active = this.plugin.settings.activeProvider;
    const activeModel = this.modelForProvider(active);
    const activeValue = `${active}::${activeModel}`;
    if (Array.from(this.modelSelect.options).some((o) => o.value === activeValue && !o.disabled)) {
      this.modelSelect.value = activeValue;
    } else if (available[0]) {
      this.modelSelect.value = `${available[0].id}::${this.modelForProvider(available[0].id)}`;
    }
  }

  private onModelChange(): void {
    if (!this.modelSelect.value) return;
    if (this.modelSelect.value === CONFIGURE_TEXT_MODEL_VALUE) {
      this.plugin.openSettings();
      return;
    }
    const profile = this.plugin.settings.modelProfiles.find((item) => item.id === this.modelSelect.value);
    if (profile) {
      this.plugin.settings.activeTextModelProfileId = profile.id;
      this.plugin.settings.activeModelProfileId = profile.id;
      this.plugin.settings.activeProvider = profile.providerId;
      void this.plugin.saveSettings();
      return;
    }
    const [providerId, model] = this.modelSelect.value.split("::");
    this.plugin.settings.activeProvider = providerId as any;
    this.setModelForProvider(providerId, model);
    void this.plugin.saveSettings();
  }

  private refreshContextHints(): void {
    const note = this.app.workspace.getActiveFile();
    const hintEl = this.contentEl.querySelector(".aio-chat-ctx-note");
    if (!hintEl) return;
    if (note instanceof TFile) {
      hintEl.setText(note.basename);
    } else {
      hintEl.setText("未打开笔记");
    }
    this.refreshInputContext();
  }

  // ---------------- 消息渲染 ----------------

  private showEmptyState(): void {
    this.messageContainer.empty();
    this.emptyState = null;
    return;
    const emptyState = this.messageContainer.createDiv({ cls: "aio-chat-empty" });
    this.emptyState = emptyState;
    const logo = emptyState.createDiv({ cls: "aio-empty-logo" });
    setIcon(logo, "message-circle");
    emptyState.createDiv({ cls: "aio-empty-title", text: "准备处理当前笔记" });
    emptyState.createDiv({
      cls: "aio-empty-sub",
      text: "选择上下文后提问，或直接使用上方工具处理笔记。",
    });
    const tips = emptyState.createDiv({ cls: "aio-empty-tips" });
    const configured = this.plugin.chatService.getProviders().some((provider) => provider.isConfigured());
    if (!configured) {
      const configBtn = tips.createEl("button", { cls: "aio-empty-action" });
      const configIcon = configBtn.createSpan();
      setIcon(configIcon, "settings-2");
      configBtn.createSpan({ text: "配置模型" });
      configBtn.addEventListener("click", () => this.plugin.openSettings());
    }
    tips.createDiv({
      cls: "aio-empty-tip",
      text: "选中文字后可直接翻译，回复可保存为 Markdown。",
    });
  }

  private addMessage(role: "user" | "assistant", text: string): HTMLElement {
    const row = this.messageContainer.createDiv({ cls: `aio-msg aio-msg-${role}` });
    const avatar = row.createDiv({ cls: "aio-msg-avatar" });
    avatar.setText(role === "user" ? "我" : "答");
    const body = row.createDiv({ cls: "aio-msg-body" });
    const content = body.createDiv({ cls: "aio-msg-content markdown-rendered" });
    void MarkdownRenderer.render(this.app, text || "…", content, "", this);
    this.scrollToBottom();
    return content;
  }

  private showTyping(): void {
    if (!this.typingEl) {
      const row = this.messageContainer.createDiv({ cls: "aio-msg aio-msg-ai" });
      row.createDiv({ cls: "aio-msg-avatar" }).setText("答");
      const body = row.createDiv({ cls: "aio-msg-body" });
      this.typingEl = body.createDiv({ cls: "aio-typing" });
      for (let i = 0; i < 3; i++) {
        this.typingEl.createSpan({ cls: "aio-typing-dot" });
      }
      this.scrollToBottom();
    }
  }

  private hideTyping(): void {
    this.typingEl?.remove();
    this.typingEl = null;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    });
  }

  // ---------------- 发送 ----------------

  private async sendMessage(): Promise<void> {
    if (this.streaming) return;
    if (this.modelSelect.value === CONFIGURE_TEXT_MODEL_VALUE) {
      this.plugin.openSettings();
      return;
    }
    const userInput = this.inputEl.value.trim();
    if (!userInput) return;
    this.inputEl.value = "";

    const activeFile = this.app.workspace.getActiveFile();
    const selectedText = this.getContextSelection().trim();
    const selection = this.selToggle.checked ? selectedText : "";
    let noteContext: { name: string; content: string } | undefined;
    if (!selection && this.noteToggle.checked && activeFile instanceof TFile && activeFile.extension === "md") {
      noteContext = {
        name: activeFile.basename,
        content: await this.app.vault.cachedRead(activeFile),
      };
    }
    const imageContext = await this.buildImageContext({
      noteContent: noteContext?.content,
      selection,
      sourceFile: activeFile instanceof TFile ? activeFile : null,
    });

    const messages = this.plugin.chatService.buildMessages(userInput, {
      noteContext,
      selection,
      imageContext,
    });
    const userMsg = messages[messages.length - 1];
    this.messages.push({ role: "user", content: userInput });

    // 重新以纯用户输入渲染（避免把注入的上下文显示出来）
    this.addMessage("user", userInput);

    this.streaming = true;
    this.sendBtn.addClass("is-hidden");
    this.stopBtn.removeClass("is-hidden");
    this.showTyping();

    const aiContent = this.addMessage("assistant", "");
    let full = "";
    this.abortCtrl = new AbortController();

    try {
      await this.plugin.chatService.chat([...messages], {
        signal: this.abortCtrl.signal,
        profileId: this.modelSelect.value || undefined,
        onStream: (delta) => {
          full += delta;
          this.renderStreaming(aiContent, full);
        },
      });
      if (!full.trim()) {
        aiContent.setText("（未返回内容）");
        full = "（未返回内容）";
      }
    } catch (err: any) {
      if (this.abortCtrl.signal.aborted) {
        full = full || "（已停止）";
      } else {
        const msg = err?.message || String(err);
        aiContent.setText(`⚠️ ${msg}`);
        full = `⚠️ ${msg}`;
      }
    } finally {
      this.messages.push({ role: "assistant", content: full });
      this.hideTyping();
      this.streaming = false;
      this.sendBtn.removeClass("is-hidden");
      this.stopBtn.addClass("is-hidden");
      this.abortCtrl = null;
      this.inputEl.focus();
    }
  }

  private renderStreaming(el: HTMLElement, text: string): void {
    el.empty();
    void MarkdownRenderer.render(this.app, text, el, "", this);
    this.scrollToBottom();
  }

  private activeProvider(): ModelProvider | undefined {
    const providers = this.plugin.chatService.getProviders();
    const [providerId] = this.modelSelect.value.split("::");
    const provider = providers.find((p) => p.id === providerId);
    return provider?.isConfigured() ? provider : undefined;
  }

  private getSelection(): string {
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (mdView?.editor) {
      const s = mdView.editor.getSelection();
      if (s) return s;
    }
    // 回退：window.getSelection
    const browserSelection = window.getSelection();
    const anchor = browserSelection?.anchorNode;
    if (anchor && this.contentEl.contains(anchor)) return "";
    return browserSelection?.toString() ?? "";
  }

  private getContextSelection(): string {
    const liveSelection = this.getSelection().trim();
    if (liveSelection) {
      const activeFile = this.app.workspace.getActiveFile();
      this.useSelectionContext(liveSelection, activeFile instanceof TFile ? activeFile.path : undefined, false);
      return liveSelection;
    }

    const pluginSnapshot = this.plugin.getSelectionSnapshot();
    if (pluginSnapshot?.text) {
      this.useSelectionContext(pluginSnapshot.text, pluginSnapshot.filePath, false);
      return pluginSnapshot.text;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (this.selectionSnapshotText && (!this.selectionSnapshotFilePath || activeFile?.path === this.selectionSnapshotFilePath)) {
      return this.selectionSnapshotText;
    }
    return "";
  }

  private useSelectionContext(text: string, filePath?: string, refresh = true): void {
    this.selectionSnapshotText = text.trim();
    this.selectionSnapshotFilePath = filePath ?? "";
    if (this.selectionSnapshotText) {
      this.setToggleState(this.selToggle, true);
      this.setToggleState(this.noteToggle, false);
    }
    if (refresh) this.refreshInputContext();
  }

  private clearSelectionContext(): void {
    this.selectionSnapshotText = "";
    this.selectionSnapshotFilePath = "";
    this.plugin.clearSelectionSnapshot();
    this.setToggleState(this.selToggle, false);
    this.refreshInputContext();
    this.inputEl.focus();
  }

  private async buildImageContext(opts: {
    noteContent?: string;
    selection?: string;
    sourceFile: TFile | null;
  }): Promise<string> {
    const sourcePath = opts.sourceFile?.path ?? "";
    const refs = [
      ...this.extractImageRefs(opts.noteContent ?? ""),
      ...this.extractImageRefs(opts.selection ?? ""),
    ];
    const allRefs = Array.from(new Set(refs));
    if (allRefs.length === 0) return "";
    const maxImages = this.clampNumber(this.plugin.settings.imageOrg.visionMaxImages, 1, 200, 20);
    const maxSizeMB = this.clampNumber(this.plugin.settings.imageOrg.visionMaxImageSizeMB, 1, 50, 5);
    const uniqueRefs = allRefs.slice(0, maxImages);
    const omittedRefs = allRefs.slice(maxImages);

    const images: ChatImagePart[] = [];
    const unresolved: string[] = [];
    const oversized: string[] = [];
    for (const ref of uniqueRefs) {
      const file = this.resolveImageFile(ref, sourcePath);
      if (!file) {
        unresolved.push(ref);
        continue;
      }
      const image = await this.fileToImagePart(file, maxSizeMB);
      if (image) {
        images.push(image);
      } else {
        oversized.push(file.path);
      }
    }

    const sourceName = opts.sourceFile?.basename ?? "选中文本";
    const analyzed = await this.plugin.chatService.analyzeImages(images, sourceName);
    const needsOcr =
      images.length > 0 &&
      (!this.hasActiveVisionModel() || /未配置视觉模型|视觉模型分析失败/.test(analyzed));
    const ocrText = needsOcr ? await this.runOcrFallback(images) : "";
    const notes: string[] = [
      `图片统计：共检测到 ${allRefs.length} 张；本次最多解析 ${maxImages} 张；实际发送视觉模型 ${images.length} 张。`,
    ];
    if (omittedRefs.length > 0) notes.push(`超过上限未解析 ${omittedRefs.length} 张：${omittedRefs.join("、")}`);
    if (oversized.length > 0) notes.push(`超过单张 ${maxSizeMB}MB 未解析 ${oversized.length} 张：${oversized.join("、")}`);
    if (unresolved.length > 0) notes.push(`未能解析这些图片链接：${unresolved.join("、")}`);
    return `${notes.join("\n")}\n${analyzed}${ocrText ? `\n\n${ocrText}` : ""}`.trim();
  }

  private hasActiveVisionModel(): boolean {
    const activeId = this.plugin.settings.activeVisionModelProfileId;
    return this.plugin.chatService.getConfiguredProfiles("vision").some((profile) => profile.id === activeId);
  }

  private async runOcrFallback(images: ChatImagePart[]): Promise<string> {
    const cfg = this.plugin.settings.imageOrg;
    if (!cfg.ocrFallbackEnabled) return "OCR 兜底：已关闭。";
    const languages = cfg.ocrLanguages?.trim() || "chi_sim+eng";

    try {
      const results: string[] = [];
      for (const image of images) {
        const result = await Tesseract.recognize(
          `data:${image.mimeType};base64,${image.data}`,
          languages,
          {
            logger: (message) => {
              if (message.status === "recognizing text") {
                // Keep logger quiet; Obsidian UI stays responsive while OCR runs.
              }
            },
          }
        );
        const text = result.data.text.trim();
        if (text) {
          results.push(image.name ? `### ${image.name}\n${text}` : text);
        }
      }
      return results.length > 0
        ? `内置 OCR 兜底结果（${languages}）：\n${results.join("\n\n")}`
        : `内置 OCR 兜底：未识别出文字（${languages}）。`;
    } catch (err: any) {
      return `内置 OCR 兜底失败：${err?.message || err}`;
    }
  }

  private extractImageRefs(markdown: string): string[] {
    const refs: string[] = [];
    const wikiRe = /!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    const mdRe = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (const match of markdown.matchAll(wikiRe)) {
      if (this.isImagePath(match[1])) refs.push(match[1].trim());
    }
    for (const match of markdown.matchAll(mdRe)) {
      const path = decodeURIComponent(match[1]).split("#")[0];
      if (this.isImagePath(path)) refs.push(path.trim());
    }
    return refs;
  }

  private resolveImageFile(ref: string, sourcePath: string): TFile | null {
    const linkTarget = this.app.metadataCache.getFirstLinkpathDest(ref, sourcePath);
    if (linkTarget instanceof TFile) return linkTarget;
    const normalized = normalizePath(ref.replace(/^\/+/, ""));
    const direct = this.app.vault.getAbstractFileByPath(normalized);
    return direct instanceof TFile ? direct : null;
  }

  private async fileToImagePart(file: TFile, maxSizeMB: number): Promise<ChatImagePart | null> {
    if (!this.isImagePath(file.path)) return null;
    if (file.stat.size > maxSizeMB * 1024 * 1024) {
      return null;
    }
    const data = await this.app.vault.readBinary(file);
    return {
      type: "image",
      mimeType: this.mimeForImage(file.extension),
      data: this.arrayBufferToBase64(data),
      name: file.path,
    };
  }

  private isImagePath(path: string): boolean {
    return /\.(png|jpe?g|webp|gif)$/i.test(path);
  }

  private mimeForImage(ext: string): string {
    const normalized = ext.toLowerCase();
    if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
    if (normalized === "webp") return "image/webp";
    if (normalized === "gif") return "image/gif";
    return "image/png";
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  private clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(n)));
  }

  private async translateSelection(): Promise<void> {
    const selection = this.getContextSelection().trim();
    if (!selection) {
      new Notice("请先在编辑器中选中要翻译的文本");
      return;
    }
    await this.plugin.translateText(selection);
  }

  private refreshInputContext(): void {
    if (!this.contextChipText) return;
    const selection = this.getContextSelection().trim();
    const activeFile = this.app.workspace.getActiveFile();
    if (selection) {
      const imageCount = this.extractImageRefs(selection).length;
      this.contextChipText.setText(`选中文本 · ${selection.length} 字${imageCount ? ` · 图片 ${imageCount}` : ""}`);
      this.contextChip.setAttr("title", selection.slice(0, 240));
      this.contextChip.addClass("is-active");
      this.contextClearBtn.removeClass("is-hidden");
      this.setToggleState(this.selToggle, true);
      this.updateContextMeter(selection.length + imageCount * 800, `选中文本 ${selection.length} 字${imageCount ? `，图片约 ${imageCount} 张` : ""}`);
      return;
    }
    if (this.noteToggle.checked && activeFile instanceof TFile) {
      this.contextChipText.setText(`# ${activeFile.basename}`);
      this.contextChip.setAttr("title", activeFile.path);
      this.contextChip.addClass("is-active");
      this.contextClearBtn.addClass("is-hidden");
      this.updateContextMeter(activeFile.stat.size, `当前笔记约 ${activeFile.stat.size} 字节`);
      return;
    }
    this.contextChipText.setText("无上下文");
    this.contextChip.setAttr("title", "未注入上下文");
    this.contextChip.removeClass("is-active");
    this.contextClearBtn.addClass("is-hidden");
    this.updateContextMeter(0, "未注入上下文");
  }

  private updateContextMeter(chars: number, label: string): void {
    if (!this.contextMeter || !this.contextMeterValue) return;
    const percent = Math.max(0, Math.min(100, Math.round((chars / CONTEXT_CHAR_BUDGET) * 100)));
    const summary = `${label}，约占上下文 ${percent}%`;
    this.contextMeter.style.setProperty("--aio-context-percent", `${percent}%`);
    this.contextMeterValue.setText("");
    this.contextMeter.setAttr("title", summary);
    this.contextMeter.setAttr("aria-label", summary);
    this.contextMeter.toggleClass("is-warn", percent >= 70 && percent < 90);
    this.contextMeter.toggleClass("is-danger", percent >= 90);
  }

  private modelsForProvider(providerId: string): string[] {
    const s = this.plugin.settings;
    const cfg =
      providerId === "openaiCompatible"
        ? s.openaiCompatible
        : providerId === "anthropic"
        ? s.anthropic
        : s.gemini;
    const models = Array.from(new Set([cfg.model, ...(cfg.models ?? [])].filter(Boolean)));
    return models.length > 0 ? models : [cfg.model];
  }

  private modelForProvider(providerId: string): string {
    const s = this.plugin.settings;
    if (providerId === "openaiCompatible") return s.openaiCompatible.model;
    if (providerId === "anthropic") return s.anthropic.model;
    return s.gemini.model;
  }

  private setModelForProvider(providerId: string, model: string): void {
    if (!model) return;
    const s = this.plugin.settings;
    if (providerId === "openaiCompatible") {
      s.openaiCompatible.model = model;
      if (!s.openaiCompatible.models.includes(model)) s.openaiCompatible.models.push(model);
    } else if (providerId === "anthropic") {
      s.anthropic.model = model;
      if (!s.anthropic.models.includes(model)) s.anthropic.models.push(model);
    } else {
      s.gemini.model = model;
      if (!s.gemini.models.includes(model)) s.gemini.models.push(model);
    }
  }

  private async saveConversation(): Promise<void> {
    if (this.messages.length === 0) {
      new Notice("当前没有可保存的对话");
      return;
    }
    const title = `AI 对话 ${timestamp()}`;
    await this.plugin.chatService.saveConversation(this.messages, title);
  }

  private clearConversation(): void {
    this.messages = [];
    this.abortCtrl?.abort();
    this.hideTyping();
    this.showEmptyState();
    this.inputEl.focus();
  }
}
