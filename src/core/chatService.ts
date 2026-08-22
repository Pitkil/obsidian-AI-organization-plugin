import { TFile } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { ChatImagePart, ChatMessage, ChatOptions, ModelKind, ModelProfile, ModelProvider } from "../types";
import { getActiveProvider } from "../providers";
import { timestamp } from "../utils";
import { notifySuccess } from "../utils/notify";

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
      throw new Error(
        "未配置可用的模型。请先在「设置 → AI Organizer」中填写 API Key 与模型名称。"
      );
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
          ? content.slice(0, CHAT_NOTE_CONTEXT_LIMIT) + "\n…[过长已截断]…"
          : content;
      contextParts.push(
        `【当前笔记：${opts.noteContext.name}】\n\`\`\`markdown\n${snippet}\n\`\`\``
      );
    }

    if (opts.selection && opts.selection.trim()) {
      contextParts.push(
        `【用户选中文本】\n\`\`\`\n${opts.selection.trim().slice(0, CHAT_SELECTION_CONTEXT_LIMIT)}\n\`\`\``
      );
    }

    if (opts.imageContext?.trim()) {
      contextParts.push(`【图片上下文】\n${opts.imageContext.trim()}`);
    }

    if (opts.extraSystem) {
      system = `${system}\n\n${opts.extraSystem}`;
    }

    let userContent = userInput;
    if (contextParts.length > 0) {
      userContent = `${contextParts.join("\n\n")}\n\n【我的问题】\n${userInput}`;
    }

    messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: userContent });
    return messages;
  }

  async analyzeImages(images: ChatImagePart[], sourceName: string): Promise<string> {
    if (images.length === 0) return "";
    const profile = this.getProfile(undefined, "vision");
    const names = images.map((image) => image.name || "未命名图片").join("、");
    if (!profile) {
      return `检测到图片：${names}。未配置视觉模型，因此没有读取图片内容；文本模型只能参考图片链接和周围文本。`;
    }

    try {
      const content: ChatMessage["content"] = [
        {
          type: "text",
          text: `请分析这些来自「${sourceName}」的图片，提取对理解文档有用的信息。用中文简洁输出：图片内容、重要文字、图表/界面含义，以及和文档可能相关的点。`,
        },
        ...images,
      ];
      const result = await this.chat(
        [
          { role: "system", content: "你是图片理解助手，只输出可交给文本模型使用的图片上下文摘要。" },
          { role: "user", content },
        ],
        { profileId: profile.id, profileKind: "vision" }
      );
      return `视觉模型「${profile.name || profile.model}」分析结果：\n${result.trim()}`;
    } catch (err: any) {
      return `检测到图片：${names}。视觉模型分析失败：${err?.message || err}。文本模型只能参考图片链接和周围文本。`;
    }
  }

  /** 将对话保存为 Markdown 笔记 */
  async saveConversation(messages: ChatMessage[], title?: string): Promise<TFile | null> {
    const folder = this.plugin.settings.chat.saveFolder.trim() || "AI 对话";
    await this.plugin.ensureFolder(folder);

    const lines: string[] = [];
    lines.push(`# ${title || `AI 对话 ${timestamp()}`}`);
    lines.push("");
    for (const m of messages) {
      if (m.role === "system") continue;
      const label = m.role === "user" ? "👤 用户" : "🤖 AI";
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

    const fileName = `${folder}/${title || `AI 对话 ${timestamp()}`}.md`;
    const file = await this.plugin.app.vault.create(fileName, lines.join("\n"));
    notifySuccess(`对话已保存：${file.path}`);
    return file;
  }

  private messageToText(content: ChatMessage["content"]): string {
    if (typeof content === "string") return content;
    return content
      .map((part) => (part.type === "text" ? part.text : `[图片：${part.name || part.mimeType}]`))
      .join("\n");
  }
}
