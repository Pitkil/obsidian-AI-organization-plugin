import type AIOrganizerPlugin from "../main";
import { stripCodeFence } from "../utils";

// ============================================================
// AI 翻译服务
// ============================================================

export class Translator {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 翻译文本到目标语言，保留 Markdown 结构 */
  async translate(text: string, targetLang: string): Promise<string> {
    const prompt = `请把下面的内容翻译成${targetLang}。
要求：
- 忠实原意，专业术语准确；专有名词保留原文或附注。
- 完整保留 Markdown 结构（标题、列表、表格、代码块、链接、图片引用、frontmatter），只翻译自然语言部分。
- 直接输出译文，不要代码围栏、不要解释、不要重复原文。

内容：
\`\`\`markdown
${text.length > 16000 ? text.slice(0, 16000) + "\n…[过长已截断]…" : text}
\`\`\``;

    const messages = this.plugin.chatService.buildMessages(prompt, {
      extraSystem: "你只输出翻译后的全文，不要输出任何解释或代码围栏。",
    });

    const raw = await this.plugin.chatService.chat(messages, {
      profileId: this.plugin.settings.translate.modelProfileId || undefined,
      profileKind: "text",
      temperature: 0.2,
    });
    return stripCodeFence(raw).trimEnd() + "\n";
  }
}
