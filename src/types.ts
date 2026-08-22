// ============================================================
// AI Organizer - 共享类型定义
// ============================================================

export type ProviderId = "openaiCompatible" | "anthropic" | "gemini";
export type ModelKind = "text" | "vision";

export interface ChatImagePart {
  type: "image";
  mimeType: string;
  data: string;
  name?: string;
}

export interface ChatTextPart {
  type: "text";
  text: string;
}

export type ChatContent = string | Array<ChatTextPart | ChatImagePart>;

export interface ModelProfile {
  id: string;
  providerId: ProviderId;
  kind?: ModelKind;
  name: string;
  enabled: boolean;
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindowTokens?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

export interface ChatOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** 终止信号（用于停止流式输出） */
  signal?: AbortSignal;
  /** 流式回调：每收到一个增量片段就调用一次 */
  onStream?: (delta: string) => void;
}

export interface ModelProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** 是否已配置（有 baseUrl/apiKey 等） */
  isConfigured(): boolean;
  /** 发起对话，返回完整文本。若传了 onStream 则同时流式回调 */
  chat(messages: ChatMessage[], options: ChatOptions): Promise<string>;
}

// ---------- 排版模式 ----------
export type FormatMode =
  | "full" // 全面排版：结构 + 语法 + 间距
  | "markdown" // 仅 Markdown 语法规范化
  | "structure" // 仅标题层级/结构优化
  | "spacing"; // 仅中英混排与标点规范

// ---------- 自定义排版模板 ----------
export interface CustomPromptTemplate {
  name: string;
  prompt: string;
}

// ---------- AI 编辑选中文本 ----------
export type TextEditOp = "polish" | "expand" | "continue" | "summarize";

// ---------- 批量处理操作 ----------
export type BatchOperation = "format" | "metadata" | "translate";

// ---------- 图片整理 ----------
export interface OrganizedImage {
  /** 图片原名（去扩展名） */
  name: string;
  ext: string;
  oldPath: string;
  newPath: string;
  moved: boolean;
}

export interface OrganizeResult {
  movedCount: number;
  orphanCount: number;
  targetFolder: string;
  items: OrganizedImage[];
}

// ---------- 元数据生成 ----------
export interface GeneratedMetadata {
  tags: string[];
  summary: string;
  aliases: string[];
}

// ---------- 收件箱整理 ----------
export interface InboxMoveSuggestion {
  fileName: string;
  /** 建议移动到的目标路径（不含文件名），空表示保持原位 */
  targetFolder: string;
  reason: string;
}

// ---------- 双链建议 ----------
export interface LinkSuggestion {
  path: string;
  basename: string;
  reason: string;
}
