import { Notice, TFile } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { GeneratedMetadata } from "../types";
import { extractJson, truncate } from "../utils";

// ============================================================
// AI 元数据生成：标签 / 摘要 / 别名 → frontmatter
// ============================================================

export class MetadataGenerator {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 对笔记内容生成元数据（不写入） */
  async generate(note: TFile): Promise<GeneratedMetadata> {
    const s = this.plugin.settings.metadata;
    const content = await this.plugin.app.vault.cachedRead(note);

    const tasks: string[] = [];
    if (s.generateTags) tasks.push(`- tags：提炼 ${s.maxTags} 个以内、贴合主题的中文或英文标签（不含 # 号）`);
    if (s.generateSummary) tasks.push(`- summary：用一句话（不超过 60 字）概括笔记核心内容，语言：${s.language}`);
    if (s.generateAliases) tasks.push(`- aliases：生成 1~3 个别名（同义词/简称），便于搜索链接`);

    const prompt = `你是笔记元数据助手。请分析下面的笔记内容，只输出 JSON（不要任何解释或代码围栏）：
{
  ${s.generateTags ? '"tags": ["标签1", "标签2"],' : ""}
  ${s.generateSummary ? '"summary": "一句话摘要",' : ""}
  ${s.generateAliases ? '"aliases": ["别名1", "别名2"]' : ""}
}

${tasks.join("\n")}

笔记内容：
\`\`\`markdown
${truncate(content, 8000)}
\`\`\``;

    const messages = this.plugin.chatService.buildMessages(prompt, {
      extraSystem: "你只输出一个合法的 JSON 对象，不要输出任何其他文字。",
    });

    const raw = await this.plugin.chatService.chat(messages);
    const parsed = extractJson<Partial<GeneratedMetadata>>(raw);

    return {
      tags: Array.isArray(parsed?.tags) ? parsed!.tags.map(String).slice(0, s.maxTags) : [],
      summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
      aliases: Array.isArray(parsed?.aliases) ? parsed!.aliases.map(String).slice(0, 5) : [],
    };
  }

  /** 生成并写入 frontmatter */
  async applyToNote(note: TFile): Promise<GeneratedMetadata | null> {
    const meta = await this.generate(note);
    const s = this.plugin.settings.metadata;

    await this.plugin.app.fileManager.processFrontMatter(note, (fm) => {
      if (s.generateTags && meta.tags.length > 0) {
        const existing = new Set<string>((fm.tags || []).map(String));
        const merged = [...existing, ...meta.tags.filter((t) => !existing.has(t))].slice(0, 20);
        fm.tags = merged;
      }
      if (s.generateSummary && meta.summary) {
        fm.summary = meta.summary;
      }
      if (s.generateAliases && meta.aliases.length > 0) {
        fm.aliases = meta.aliases;
      }
    });

    new Notice(`已为「${note.basename}」生成元数据`);
    return meta;
  }
}
