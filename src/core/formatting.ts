import { Notice, TFile } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { FormatMode } from "../types";
import { stripCodeFence, truncate } from "../utils";

// ============================================================
// AI 排版服务
// ============================================================

const MODE_PROMPTS: Record<FormatMode, string> = {
  full: `
你是专业的 Markdown 排版助手。请对下面的笔记做「全面排版」：
1. 规范标题层级：确保 H1 唯一作为笔记大标题，其余按层级依次递进（## → ###），不要跳级。
2. 优化结构：为长段落拆分小标题，把列表/要点归组，删掉重复内容，保持原意不变。
3. 规范 Markdown 语法：统一列表符号、代码块、引用、表格格式；相邻段落之间空一行。
4. 规范中英混排：中文与英文/数字之间加空格；统一全角/半角标点（正文用中文标点，代码与英文上下文用半角）。
5. 不要新增事实性内容，不要删减有价值的信息；保留原有 frontmatter 与图片/嵌入引用。
`,
  markdown: `
你是专业的 Markdown 语法规范化助手。只做语法层调整，不改变结构与内容：
1. 统一列表符号（- 或 *）、缩进；修复无序/有序列表混排。
2. 统一代码块与行内代码语法；修复引用块（>）格式。
3. 保证标题与段落之间有且只有一个空行；表格对齐。
4. 统一标点（中文正文用全角，英文/代码用半角）。
5. 保留原有 frontmatter 与所有嵌入/图片引用。
`,
  structure: `
你是笔记结构优化助手。只优化层级与结构，不改变文字内容：
1. 确保唯一 H1 大标题，层级依次递进不跳级。
2. 为内容合理补充分节标题（## / ###），使逻辑清晰。
3. 把并列要点整理成列表；删除明显冗余的空行。
4. 保留原有 frontmatter 与所有嵌入/图片引用，不要新增事实。
`,
  spacing: `
你是中英混排与标点规范化助手。只做排版细节调整：
1. 中文与英文/数字之间加一个空格（如：Obsidian 插件、2026 年）。
2. 中文正文统一使用全角标点（，。；：？！「」）；英文与代码内使用半角。
3. 去除多余空格与空行；行尾不留空格。
4. 不要改变文字内容与结构。
`,
};

export class FormattingService {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 解析排版提示词：优先使用自定义模板，其次内置模式 */
  private resolvePrompt(mode: string): string {
    const template = this.plugin.settings.formatting.customTemplates.find(
      (t) => t.name === mode
    );
    if (template && template.prompt.trim()) {
      return template.prompt.trim();
    }
    return MODE_PROMPTS[mode as FormatMode] ?? MODE_PROMPTS.full;
  }

  /** 对文本执行 AI 排版，返回格式化后的文本 */
  async format(
    content: string,
    mode: string,
    opts: { onStream?: (delta: string) => void } = {}
  ): Promise<string> {
    const prompt = `${this.resolvePrompt(mode)}

请直接输出排版后的完整 Markdown 全文（不要用代码块包裹，不要添加任何解释性文字）：

\`\`\`markdown
${truncate(content, 16000)}
\`\`\``;

    const messages = this.plugin.chatService.buildMessages(prompt, {
      extraSystem:
        "你只输出排版后的笔记全文，不要输出任何解释、注释或代码围栏标记。输出必须仍是合法的 Markdown。",
    });

    const raw = await this.plugin.chatService.chat(messages, {
      onStream: opts.onStream,
    });

    const formatted = stripCodeFence(raw).trimEnd();
    this.validateFormattedContent(content, formatted);
    return formatted + "\n";
  }

  private validateFormattedContent(before: string, after: string): void {
    const beforeText = before.trim();
    const afterText = after.trim();
    if (!afterText) {
      throw new Error("模型没有返回可用的排版内容，已取消写入。");
    }

    if (beforeText.length >= 200) {
      const minLength = Math.max(80, Math.floor(beforeText.length * 0.25));
      if (afterText.length < minLength) {
        throw new Error(
          `模型返回内容异常偏短（${beforeText.length} → ${afterText.length} 字符），已取消排版，避免误清空笔记。`
        );
      }
    }

    const imageRefsBefore = beforeText.match(/!\[[^\]]*?\]\([^)]+?\)|!\[\[[^\]]+?\]\]/g) ?? [];
    const imageRefsAfter = afterText.match(/!\[[^\]]*?\]\([^)]+?\)|!\[\[[^\]]+?\]\]/g) ?? [];
    if (imageRefsAfter.length < imageRefsBefore.length) {
      throw new Error("模型返回内容丢失了部分图片/嵌入引用，已取消排版。");
    }
  }

  /** 对当前笔记执行排版，成功后写回（外部负责预览确认） */
  async formatActiveNote(
    mode: string,
    opts: { onStream?: (delta: string) => void } = {}
  ): Promise<{ file: TFile; before: string; after: string } | null> {
    const file = this.plugin.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile) || file.extension !== "md") {
      new Notice("请先打开一篇 Markdown 笔记");
      return null;
    }
    const before = await this.plugin.app.vault.read(file);
    const after = await this.format(before, mode, opts);
    return { file, before, after };
  }
}
