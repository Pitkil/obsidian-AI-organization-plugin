import { TFile } from "obsidian";
import type AIOrganizerPlugin from "../main";
import type { BatchOperation } from "../types";
import { sleep } from "../utils";
import { notifyError, notifySuccess } from "../utils/notify";

// ============================================================
// 批量 AI 处理：对多篇笔记批量执行 排版 / 元数据 / 翻译
// ============================================================

export interface BatchItemResult {
  file: TFile;
  ok: boolean;
  message: string;
}

export class BatchProcessor {
  constructor(private plugin: AIOrganizerPlugin) {}

  /** 执行批量处理，返回逐项结果 */
  async process(
    files: TFile[],
    operation: BatchOperation,
    progress: (done: number, total: number, current: TFile) => void
  ): Promise<BatchItemResult[]> {
    const results: BatchItemResult[] = [];
    const delay = Math.max(0, this.plugin.settings.batch.delayMs);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      progress(i, files.length, file);
      try {
        switch (operation) {
          case "format": {
            const content = await this.plugin.app.vault.read(file);
            const formatted = await this.plugin.formatting.format(content, this.plugin.settings.formatting.mode);
            if (formatted !== content) {
              await this.plugin.app.vault.modify(file, formatted);
            }
            results.push({ file, ok: true, message: "排版完成" });
            break;
          }
          case "metadata": {
            await this.plugin.metadataGenerator.applyToNote(file);
            results.push({ file, ok: true, message: "元数据已生成" });
            break;
          }
          case "translate": {
            const content = await this.plugin.app.vault.read(file);
            const translated = await this.plugin.translator.translate(content, this.plugin.settings.translate.defaultTarget);
            if (translated !== content) {
              await this.plugin.app.vault.modify(file, translated);
            }
            results.push({ file, ok: true, message: "翻译完成" });
            break;
          }
        }
      } catch (err: any) {
        results.push({ file, ok: false, message: err?.message || String(err) });
      }
      if (i < files.length - 1 && delay > 0) await sleep(delay);
    }

    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      notifyError(`批量处理完成：成功 ${results.length - failed}，失败 ${failed}`, 8000);
    } else {
      notifySuccess(`批量处理完成：${results.length} 篇`);
    }
    return results;
  }
}
