import type AIOrganizerPlugin from "../main";
import type { TextEditOp } from "../types";
import { stripCodeFence } from "../utils";

// ============================================================
// AI 文本编辑服务：润色 / 扩写 / 续写 / 压缩
// ============================================================

const OP_PROMPTS: Record<TextEditOp, string> = {
  polish: `请对下面文本进行【润色】：优化表达、语法、用词与流畅度；保持原意、结构与 Markdown 格式；不改变事实内容。直接输出润色后的完整文本，不要解释。`,
  expand: `请对下面文本进行【扩写】：在保持原意的基础上，补充细节、例证、论据或展开说明，使内容更丰富完整；保留 Markdown 格式。直接输出扩写后的完整文本，不要解释。`,
  continue: `请接着下面文本自然地【续写】：延续相同的主题、语气与风格，内容衔接流畅；保留 Markdown 格式。直接输出续写内容（不要重复原文），不要解释。`,
  summarize: `请对下面文本进行【压缩】：提炼要点、精简冗余，保留核心信息与 Markdown 结构。直接输出压缩后的完整文本，不要解释。`,
};

export class TextEditor {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 对选中文本执行编辑操作 */
  async transform(text: string, op: TextEditOp): Promise<string> {
    const prompt = `${OP_PROMPTS[op]}\n\n\`\`\`\n${text.slice(0, 16000)}\n\`\`\``;
    const messages = this.plugin.chatService.buildMessages(prompt, {
      extraSystem: "你只输出结果文本本身，不要输出任何解释、说明或代码围栏。",
    });
    const raw = await this.plugin.chatService.chat(messages);
    return stripCodeFence(raw).trim();
  }
}
