import { Plugin } from "obsidian";
import type { CustomPromptTemplate, ModelProfile, ProviderId } from "./types";

// ============================================================
// 插件设置结构
// ============================================================

export interface AIOAnnotation {
  id: string;
  filePath: string;
  quote: string;
  type: "translation" | "thought";
  translated?: string;
  thought?: string;
  targetLang?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AIOrganizerSettings {
  /** 当前激活的模型提供商 */
  activeProvider: ProviderId;
  activeModelProfileId: string;
  activeTextModelProfileId: string;
  activeVisionModelProfileId: string;
  modelProfiles: ModelProfile[];
  annotations: AIOAnnotation[];

  // ---------- OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / 智谱 / Kimi / Ollama 等） ----------
  openaiCompatible: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    models: string[];
    temperature: number;
    maxTokens: number;
  };

  // ---------- Anthropic Claude ----------
  anthropic: {
    enabled: boolean;
    apiKey: string;
    model: string;
    models: string[];
    temperature: number;
    maxTokens: number;
  };

  // ---------- Google Gemini ----------
  gemini: {
    enabled: boolean;
    apiKey: string;
    model: string;
    models: string[];
    temperature: number;
    maxTokens: number;
  };

  // ---------- AI 排版 ----------
  formatting: {
    /** 默认排版模式（内置模式 id 或自定义模板名） */
    mode: string;
    /** 排版前先弹出预览确认 */
    previewBeforeApply: boolean;
    /** 自定义排版模板 */
    customTemplates: CustomPromptTemplate[];
  };

  // ---------- 一键图片整理 ----------
  imageOrg: {
    /** 附件根目录（相对库根，如 "attachments" 或 "附件"） */
    attachmentRoot: string;
    /** 是否按笔记名建子文件夹：附件根/笔记名/ */
    subfolderPerNote: boolean;
    /** 是否自动重命名图片为「笔记名-N」 */
    renameImages: boolean;
    /** 整理时是否扫描并标记孤儿附件 */
    checkOrphans: boolean;
    visionMaxImages: number;
    visionMaxImageSizeMB: number;
    ocrFallbackEnabled: boolean;
    ocrLanguages: string;
  };

  // ---------- AI 元数据（标签/摘要/别名） ----------
  metadata: {
    generateTags: boolean;
    generateSummary: boolean;
    generateAliases: boolean;
    /** 摘要/标签使用语言，如 "中文"、"English" */
    language: string;
    /** 标签数量上限 */
    maxTags: number;
  };

  // ---------- 智能收件箱 ----------
  inbox: {
    inboxFolder: string;
    /** 是否允许 AI 建议创建新文件夹 */
    allowCreateFolder: boolean;
  };

  // ---------- AI 双链建议 ----------
  links: {
    maxSuggestions: number;
    /** 参与候选的笔记数量上限（防止提示词过大） */
    candidateLimit: number;
  };

  // ---------- 批量处理 ----------
  batch: {
    /** 批量操作间隔（毫秒），避免触发限流 */
    delayMs: number;
  };

  // ---------- AI 翻译 ----------
  translate: {
    defaultTarget: string;
    modelProfileId: string;
    targetLanguages: string[];
  };

  // ---------- 对话面板 ----------
  chat: {
    /** 保存对话的文件夹 */
    saveFolder: string;
    /** 是否默认注入当前笔记内容 */
    injectCurrentNote: boolean;
    /** 是否默认注入选中文本 */
    injectSelection: boolean;
    /** 系统提示词 */
    systemPrompt: string;
  };
}

export const DEFAULT_SETTINGS: AIOrganizerSettings = {
  activeProvider: "openaiCompatible",
  activeModelProfileId: "",
  activeTextModelProfileId: "",
  activeVisionModelProfileId: "",
  modelProfiles: [],
  annotations: [],

  openaiCompatible: {
    enabled: true,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    models: [],
    temperature: 0.7,
    maxTokens: 4096,
  },

  anthropic: {
    enabled: true,
    apiKey: "",
    model: "",
    models: [],
    temperature: 0.7,
    maxTokens: 4096,
  },

  gemini: {
    enabled: true,
    apiKey: "",
    model: "",
    models: [],
    temperature: 0.7,
    maxTokens: 4096,
  },

  formatting: {
    mode: "full",
    previewBeforeApply: true,
    customTemplates: [],
  },

  imageOrg: {
    attachmentRoot: "attachments",
    subfolderPerNote: true,
    renameImages: true,
    checkOrphans: true,
    visionMaxImages: 20,
    visionMaxImageSizeMB: 5,
    ocrFallbackEnabled: true,
    ocrLanguages: "chi_sim+eng",
  },

  metadata: {
    generateTags: true,
    generateSummary: true,
    generateAliases: true,
    language: "中文",
    maxTags: 10,
  },

  inbox: {
    inboxFolder: "Inbox",
    allowCreateFolder: true,
  },

  links: {
    maxSuggestions: 5,
    candidateLimit: 300,
  },

  batch: {
    delayMs: 800,
  },

  translate: {
    defaultTarget: "中文",
    modelProfileId: "",
    targetLanguages: ["中文", "English", "日本語", "한국어", "Deutsch", "Français", "Español"],
  },

  chat: {
    saveFolder: "AI 对话",
    injectCurrentNote: true,
    injectSelection: true,
    systemPrompt:
      "你是一个嵌入在 Obsidian 中的 AI 助手「AI Organizer」。回答要简洁、准确、结构清晰，默认使用中文。涉及 Markdown 时请输出规范的 Markdown 语法，便于直接写入笔记。",
  },
};

// ============================================================
// 设置加载/保存
// ============================================================

export async function loadSettings(plugin: Plugin): Promise<AIOrganizerSettings> {
  const data = await plugin.loadData();
  return normalizeSettings(deepMerge(DEFAULT_SETTINGS, data || {}));
}

export async function saveSettings(plugin: Plugin, settings: AIOrganizerSettings): Promise<void> {
  await plugin.saveData(settings);
}

/** 递归浅合并，保证新增设置字段有默认值 */
function deepMerge<T>(base: T, override: Partial<T>): T {
  const result: any = { ...(base as any) };
  for (const key of Object.keys(override || {})) {
    const baseVal = (base as any)[key];
    const overrideVal = (override as any)[key];
    if (
      baseVal &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal) &&
      overrideVal &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal;
    }
  }
  return result as T;
}

function normalizeSettings(settings: AIOrganizerSettings): AIOrganizerSettings {
  settings.annotations = (settings.annotations ?? []).filter(
    (item) => item && item.filePath && item.quote && item.type
  );

  settings.translate.targetLanguages = Array.from(
    new Set([settings.translate.defaultTarget, ...(settings.translate.targetLanguages ?? [])].map((item) => item.trim()).filter(Boolean))
  );

  settings.modelProfiles = (settings.modelProfiles ?? [])
    .filter((profile) => profile && profile.providerId)
    .map((profile) => ({
      ...profile,
      id: profile.id || createProfileId(profile.providerId, profile.model || "profile"),
      kind: profile.kind ?? "text",
      name: profile.name || profile.model || "",
      enabled: profile.enabled !== false,
      apiKey: profile.apiKey ?? "",
      model: profile.model ?? "",
    }));

  if (settings.modelProfiles.length === 0) {
    migrateLegacyProfile(settings, "openaiCompatible");
    migrateLegacyProfile(settings, "anthropic");
    migrateLegacyProfile(settings, "gemini");
  }

  const textFallback = settings.modelProfiles.find(
    (profile) => (profile.kind ?? "text") === "text" && isProfileUsable(profile)
  );
  const visionFallback = settings.modelProfiles.find(
    (profile) => profile.kind === "vision" && isProfileUsable(profile)
  );
  const activeText = settings.modelProfiles.find(
    (profile) => profile.id === settings.activeTextModelProfileId && (profile.kind ?? "text") === "text" && isProfileUsable(profile)
  );
  const activeVision = settings.modelProfiles.find(
    (profile) => profile.id === settings.activeVisionModelProfileId && profile.kind === "vision" && isProfileUsable(profile)
  );
  const legacyActive = settings.modelProfiles.find(
    (profile) => profile.id === settings.activeModelProfileId && isProfileUsable(profile)
  );

  if (!activeText && textFallback) settings.activeTextModelProfileId = textFallback.id;
  if (!activeVision && settings.activeVisionModelProfileId) settings.activeVisionModelProfileId = visionFallback?.id ?? "";
  if (!settings.activeTextModelProfileId && legacyActive?.kind !== "vision") {
    settings.activeTextModelProfileId = legacyActive?.id ?? "";
  }
  const activeTranslate = settings.modelProfiles.find(
    (profile) => profile.id === settings.translate.modelProfileId && (profile.kind ?? "text") === "text" && isProfileUsable(profile)
  );
  if (!activeTranslate) settings.translate.modelProfileId = pickSmallTextProfile(settings.modelProfiles)?.id ?? "";

  const selectedText = settings.modelProfiles.find((profile) => profile.id === settings.activeTextModelProfileId);
  if (selectedText) {
    settings.activeModelProfileId = selectedText.id;
    settings.activeProvider = selectedText.providerId;
  } else {
    settings.activeModelProfileId = "";
  }
  return settings;
}

function pickSmallTextProfile(profiles: ModelProfile[]): ModelProfile | undefined {
  const usable = profiles.filter((profile) => (profile.kind ?? "text") === "text" && isProfileUsable(profile));
  return (
    usable.find((profile) => /mini|small|flash|haiku|lite|turbo|qwen|deepseek-chat/i.test(`${profile.name} ${profile.model}`)) ??
    usable[0]
  );
}

function migrateLegacyProfile(settings: AIOrganizerSettings, providerId: ProviderId): void {
  const cfg =
    providerId === "openaiCompatible"
      ? settings.openaiCompatible
      : providerId === "anthropic"
      ? settings.anthropic
      : settings.gemini;
  if (!cfg.model) return;
  const profile: ModelProfile = {
    id: createProfileId(providerId, cfg.model),
    providerId,
    name: cfg.model,
    enabled: cfg.enabled,
    baseUrl: providerId === "openaiCompatible" ? settings.openaiCompatible.baseUrl : undefined,
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
  };
  if (isProfileUsable(profile)) settings.modelProfiles.push(profile);
}

function isProfileUsable(profile: ModelProfile): boolean {
  if (!profile.enabled || !profile.model) return false;
  if (profile.providerId === "openaiCompatible") {
    if (!profile.baseUrl) return false;
    return !!profile.apiKey || isLocalEndpoint(profile.baseUrl);
  }
  return !!profile.apiKey;
}

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function createProfileId(providerId: ProviderId, model: string): string {
  return `${providerId}-${model}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}
