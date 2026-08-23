import { TFile } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { ChatImagePart, ChatMessage, ChatOptions, ModelKind, ModelProfile, ModelProvider } from "../types";
import { getActiveProvider } from "../providers";
import { timestamp } from "../utils";
import { notifySuccess } from "../utils/notify";
import { t, tpl } from "../i18n";

export const CHAT_NOTE_CONTEXT_LIMIT = 4000;
export const CHAT_SELECTION_CONTEXT_LIMIT = 4000;
export const CHAT_CONTEXT_METER_BUDGET = CHAT_NOTE_CONTEXT_LIMIT + CHAT_SELECTION_CONTEXT_LIMIT;
export const CHAT_IMAGE_CONTEXT_ESTIMATE_CHARS = 800;

// ============================================================
// 对话服务：统一入口，负责取提供商、注入上下文、保存对话
// ============================================================

export class ChatService {
  constructor(private plugin: AIOrganizerPlugin) {}

  getProviders(): ModelProvider[] {
    return this.plugin.providers;
  }

  /** 获取可用（已配置）的提供商列表 */
  getAvailableProviders(): ModelProvider[] {
    return this.plugin.providers.filter((p) => p.isConfigured());
  }

  getConfiguredProfiles(kind?: ModelKind): ModelProfile[] {
    return this.plugin.settings.modelProfiles.filter(
      (profile) => this.isProfileUsable(profile) && (!kind || (profile.kind ?? "text") === kind)
    );
  }

  getActiveProvider(): ModelProvider | null {
    return getActiveProvider(this.plugin.settings, this.plugin.providers);
  }

  /** 发起一次对话（可流式） */
  async chat(
    messages: ChatMessage[],
    options: Partial<ChatOptions> & { provider?: ModelProvider; profileId?: string; profileKind?: ModelKind } = {}
  ): Promise<string> {
    const profile = this.getProfile(options.profileId, options.profileKind ?? "text");
    const provider =
      options.provider ??
      (profile ? this.plugin.providers.find((item) => item.id === profile.providerId) ?? null : null) ??
      this.getActiveProvider();
    if (!provider || (!profile && !provider.isConfigured())) {
      throw new Error(t("notify.modelNotConfigured"));
    }
    const s = this.plugin.settings;
    const cfg =
      provider.id === "openaiCompatible"
        ? s.openaiCompatible
        : provider.id === "anthropic"
        ? s.anthropic
        : s.gemini;

    const fullOptions: ChatOptions = {
      model: options.model ?? profile?.model ?? cfg.model,
      apiKey: options.apiKey ?? profile?.apiKey,
      baseUrl: options.baseUrl ?? profile?.baseUrl,
      temperature: options.temperature ?? profile?.temperature ?? cfg.temperature,
      maxTokens: options.maxTokens ?? profile?.maxTokens ?? cfg.maxTokens,
      signal: options.signal,
      onStream: options.onStream,
    };

    return provider.chat(messages, fullOptions);
  }

  private getProfile(profileId?: string, kind: ModelKind = "text"): ModelProfile | undefined {
    const profiles = this.getConfiguredProfiles(kind);
    const activeId =
      kind === "vision"
        ? this.plugin.settings.activeVisionModelProfileId
        : this.plugin.settings.activeTextModelProfileId || this.plugin.settings.activeModelProfileId;
    if (kind === "vision" && !profileId && !activeId) {
      return undefined;
    }
    return (
      profiles.find((profile) => profile.id === profileId) ??
      profiles.find((profile) => profile.id === activeId) ??
      profiles[0]
    );
  }

  private isProfileUsable(profile: ModelProfile): boolean {
    if (!profile.enabled || !profile.model) return false;
    if (profile.providerId === "openaiCompatible") {
      if (!profile.baseUrl) return false;
      return !!profile.apiKey || this.isLocalEndpoint(profile.baseUrl);
    }
    return !!profile.apiKey;
  }

  private isLocalEndpoint(baseUrl: string): boolean {
    try {
      const host = new URL(baseUrl).hostname.toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch {
      return false;
    }
  }

  /** 构建带上下文注入的消息列表 */
  buildMessages(
    userInput: string,
    opts: {
      /** 当前笔记内容（已由调用方异步读取） */
      noteContext?: { name: string; content: string };
      /** 选中的文本 */
      selection?: string;
      /** 追加到系统提示词的额外指令 */
      extraSystem?: string;
      /** 图片经视觉模型分析后的文本上下文 */
      imageContext?: string;
    } = {}
  ): ChatMessage[] {
    const s = this.plugin.settings;
    const messages: ChatMessage[] = [];

    let system = s.chat.systemPrompt;
    const contextParts: string[] = [];

    if (opts.noteContext) {
      const content = opts.noteContext.content.trim();
      const snippet =
        content.length > CHAT_NOTE_CONTEXT_LIMIT
          ? content.slice(0, CHAT_NOTE_CONTEXT_LIMIT) + t("chat.truncatedSuffix")
          : content;
      contextParts.push(
        `${tpl("chat.injectNoteLabel", { name: opts.noteContext.name })}\n\`\`\`markdown\n${snippet}\n\`\`\``
      );
    }

    if (opts.selection && opts.selection.trim()) {
      contextParts.push(
        `${t("chat.injectSelectionLabel")}\n\`\`\`\n${opts.selection.trim().slice(0, CHAT_SELECTION_CONTEXT_LIMIT)}\n\`\`\``
      );
    }

    if (opts.imageContext?.trim()) {
      contextParts.push(`${t("chat.injectImageContextLabel")}\n${opts.imageContext.trim()}`);
    }

    if (opts.extraSystem) {
      system = `${system}\n\n${opts.extraSystem}`;
    }

    let userContent = userInput;
    if (contextParts.length > 0) {
      userContent = `${contextParts.join("\n\n")}\n\n${t("chat.injectQuestionLabel")}\n${userInput}`;
    }

    messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: userContent });
    return messages;
  }

  async analyzeImages(images: ChatImagePart[], sourceName: string): Promise<string> {
    if (images.length === 0) return "";
    const profile = this.getProfile(undefined, "vision");
    const names = images.map((image) => image.name || t("chat.unnamedImage")).join("、");
    if (!profile) {
      return tpl("chat.visionNotConfigured", { names });
    }

    try {
      const content: ChatMessage["content"] = [
        {
          type: "text",
          text: tpl("chat.visionAnalyzePrompt", { source: sourceName, lang: t("chat.outputLang") }),
        },
        ...images,
      ];
      const result = await this.chat(
        [
          { role: "system", content: t("chat.visionSystemPrompt") },
          { role: "user", content },
        ],
        { profileId: profile.id, profileKind: "vision" }
      );
      return `${tpl("chat.visionResult", { name: profile.name || profile.model })}\n${result.trim()}`;
    } catch (err: any) {
      return tpl("chat.visionFailed", { names, msg: err?.message || err });
    }
  }

  /** 将对话保存为 Markdown 笔记 */
  async saveConversation(messages: ChatMessage[], title?: string): Promise<TFile | null> {
    const folder = this.plugin.settings.chat.saveFolder.trim() || "AI 对话";
    await this.plugin.ensureFolder(folder);

    const lines: string[] = [];
    lines.push(`# ${title || tpl("chat.conversationTitle", { time: timestamp() })}`);
    lines.push("");
    for (const m of messages) {
      if (m.role === "system") continue;
      const label = m.role === "user" ? t("chat.saveUserLabel") : t("chat.saveAILabel");
      lines.push(`> [!quote] ${label}`);
      lines.push(">");
      lines.push(
        "> " +
          this.messageToText(m.content)
            .split("\n")
            .map((l) => (l.trim() ? l : "&nbsp;"))
            .join("\n> ")
      );
      lines.push("");
    }

    const fileName = `${folder}/${title || tpl("chat.conversationTitle", { time: timestamp() })}.md`;
    const file = await this.plugin.app.vault.create(fileName, lines.join("\n"));
      notifySuccess(tpl("chat.savedConversation", { path: file.path }));
    return file;
  }

  private messageToText(content: ChatMessage["content"]): string {
    if (typeof content === "string") return content;
    return content
      .map((part) => (part.type === "text" ? part.text : tpl("chat.imagePartText", { name: part.name || part.mimeType })))
      .join("\n");
  }
}
