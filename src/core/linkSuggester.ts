import { Notice, TFile } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { LinkSuggestion } from "../types";
import { extractJson, truncate } from "../utils";

// ============================================================
// AI 双链建议：根据当前笔记内容推荐相关笔记，建立双向链接
// ============================================================

export class LinkSuggester {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 收集候选笔记（标题 + 首行摘要） */
  private collectCandidates(current: TFile): { path: string; basename: string; snippet: string }[] {
    const limit = this.plugin.settings.links.candidateLimit;
    const notes = this.plugin.app.vault.getMarkdownFiles().filter((f) => f.path !== current.path);
    // 优先取与当前笔记同目录的，再取标题相似度高的（简单启发式）
    const scored = notes
      .map((n) => {
        const curTokens = new Set(
          current.basename.toLowerCase().split(/[\s\-_/]+/).filter(Boolean)
        );
        let score = 0;
        for (const t of curTokens) {
          if (n.basename.toLowerCase().includes(t)) score += 2;
        }
        return { n, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ n }) => ({
      path: n.path,
      basename: n.basename,
      snippet: "",
    }));
  }

  /** 生成双链建议 */
  async suggest(current: TFile): Promise<LinkSuggestion[]> {
    const s = this.plugin.settings.links;
    const candidates = this.collectCandidates(current);

    // 读取候选笔记摘要（仅当候选数不算太多时）
    for (const c of candidates) {
      const f = this.plugin.app.vault.getAbstractFileByPath(c.path);
      if (f instanceof TFile) {
        try {
          const content = await this.plugin.app.vault.cachedRead(f);
          const firstLine = content.split("\n").find((l) => l.trim().length > 0) || "";
          c.snippet = firstLine.trim().slice(0, 80);
        } catch {
          /* ignore */
        }
      }
    }

    const currentContent = await this.plugin.app.vault.cachedRead(current);

    const prompt = `你是知识库关联助手。当前笔记如下：

\`\`\`markdown
${truncate(currentContent, 4000)}
\`\`\`

库内候选笔记（路径 — 首行摘要）：
${candidates
  .map((c) => `- ${c.path}${c.snippet ? ` — ${c.snippet}` : ""}`)
  .join("\n")}

请从中选出与当前笔记主题最相关、建立链接最有价值的 ${s.maxSuggestions} 篇，输出 JSON 数组（不要代码围栏、不要解释）：
[
  {"path": "候选笔记路径", "reason": "为什么相关，一句话"}
]

要求：只从候选中选择；相关度不足时输出空数组 []。`;

    const messages = this.plugin.chatService.buildMessages(prompt, {
      extraSystem: "你只输出一个合法的 JSON 数组，不要输出任何其他文字。",
    });

    const raw = await this.plugin.chatService.chat(messages);
    const parsed = extractJson<LinkSuggestion[]>(raw);
    if (!Array.isArray(parsed)) return [];

    const validPaths = new Set(candidates.map((c) => c.path));
    return parsed
      .filter((s) => s && validPaths.has(s.path))
      .slice(0, s.maxSuggestions)
      .map((s) => ({
        path: s.path,
        basename: s.path.split("/").pop()!.replace(/\.md$/, ""),
        reason: s.reason || "",
      }));
  }

  /** 将建议链接追加到当前笔记末尾 */
  async appendLinks(note: TFile, suggestions: LinkSuggestion[]): Promise<number> {
    if (suggestions.length === 0) {
      new Notice("没有可添加的相关链接");
      return 0;
    }
    const content = await this.plugin.app.vault.read(note);
    const lines = [
      "",
      "## 相关笔记",
      "",
      ...suggestions.map((s) => `- [[${s.basename}]]${s.reason ? ` — ${s.reason}` : ""}`),
      "",
    ];
    const newContent = content.trimEnd() + "\n" + lines.join("\n");
    await this.plugin.app.vault.modify(note, newContent);
    new Notice(`已添加 ${suggestions.length} 个相关链接`);
    return suggestions.length;
  }
}
